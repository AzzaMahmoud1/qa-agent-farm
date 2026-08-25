"""Standalone Analyst agent entry point.

Not wired into the JS pipeline. Calls Anthropic's Messages API directly —
same endpoint, default model, and env var as the `anthropic_api` runner in
`lib/llm-settings.js` / `src/agents/requirementAnalyst.js`, so behavior is
consistent with the rest of the farm without adding a second provider
abstraction (this component doesn't need cursor_agent_cli/openai/openrouter
support; it's a separate, minimal tool).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from pydantic import BaseModel, ValidationError

from .models import SKILL_RESULT_MODELS, SkillName
from .skills import Skill, load_skill
from .validation import GATE_CHECKS, GateResult

ANTHROPIC_API_VERSION = "2023-06-01"
DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-5"
DEFAULT_MAX_TOKENS = 8192

_FENCE_RE = re.compile(r"```json\s*(.*?)```", re.IGNORECASE | re.DOTALL)


class AnalystAgentError(RuntimeError):
    pass


@dataclass
class AnalystResult:
    skill: SkillName
    scratchpad: str
    parsed: BaseModel
    gate: GateResult
    raw_text: str


def build_prompt(skill: Skill, ticket_text: str, extra: str = "") -> str:
    """Mirrors `buildFullPrompt` in `src/agents/requirementAnalyst.js`:
    skill instructions + ticket text + optional retry/extra context."""
    parts = [skill.instructions, ticket_text.strip()]
    if extra:
        parts.append(extra)
    return "\n\n".join(parts)


def extract_final_json(full_text: str) -> tuple[str, dict[str, Any]]:
    """Mirrors `extractFinalJson` in `src/agents/utils/extractFinalJson.js`:
    take the LAST ```json fenced block, parse it; everything before it is
    the scratchpad."""
    matches = list(_FENCE_RE.finditer(full_text))
    if not matches:
        raise AnalystAgentError(
            "No ```json fenced block found in Analyst output — expected scratchpad "
            "first, then a final JSON block"
        )
    last = matches[-1]
    json_raw = last.group(1).strip()
    scratchpad = full_text[: last.start()].strip()
    try:
        parsed = json.loads(json_raw)
    except json.JSONDecodeError as exc:
        raise AnalystAgentError(f"Failed to parse Analyst final JSON block: {exc}") from exc
    return scratchpad, parsed


def call_anthropic(prompt: str, *, api_key: str, model: str = DEFAULT_MODEL,
                    base_url: str = DEFAULT_BASE_URL, max_tokens: int = DEFAULT_MAX_TOKENS,
                    timeout: float = 120.0) -> str:
    """Direct Anthropic Messages API call — mirrors `callAnthropicApi` in
    `src/agents/requirementAnalyst.js`."""
    if not api_key:
        raise AnalystAgentError(
            "Anthropic call requires an API key — set ANTHROPIC_API_KEY "
            "(create one at console.anthropic.com)."
        )

    response = httpx.post(
        base_url,
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_API_VERSION,
        },
        json={
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=timeout,
    )
    body = response.json() if response.content else None
    if response.is_error:
        msg = (body or {}).get("error", {}).get("message") or f"HTTP {response.status_code}"
        raise AnalystAgentError(f"Anthropic API error ({response.status_code}): {msg}")

    if not body or body.get("type") == "error" or body.get("error"):
        msg = (body or {}).get("error", {}).get("message") or json.dumps(body or {})[:500]
        raise AnalystAgentError(f"Anthropic API error: {msg}")

    blocks = body.get("content") or []
    text = "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
    if not text.strip():
        raise AnalystAgentError("Anthropic API returned no text content")
    return text


class AnalystAgent:
    def __init__(self, *, api_key: Optional[str] = None, model: str = DEFAULT_MODEL,
                 base_url: str = DEFAULT_BASE_URL):
        import os

        self.api_key = api_key if api_key is not None else os.environ.get("ANTHROPIC_API_KEY", "")
        self.model = model
        self.base_url = base_url

    def build(self, skill_name: SkillName | str, ticket_text: str) -> tuple[Skill, str]:
        """Load the skill and build its prompt, without calling the LLM.
        Used by `--dry-run` and by tests that shouldn't need a live API key."""
        skill = load_skill(skill_name)
        prompt = build_prompt(skill, ticket_text)
        return skill, prompt

    def parse_response(self, skill_name: SkillName | str, full_text: str) -> AnalystResult:
        name = SkillName(skill_name) if not isinstance(skill_name, SkillName) else skill_name
        scratchpad, raw_parsed = extract_final_json(full_text)

        model_cls = SKILL_RESULT_MODELS[name]
        try:
            parsed = model_cls.model_validate(raw_parsed)
        except ValidationError as exc:
            raise AnalystAgentError(f"Analyst output failed schema validation: {exc}") from exc

        gate = GATE_CHECKS[name](parsed)
        return AnalystResult(skill=name, scratchpad=scratchpad, parsed=parsed, gate=gate, raw_text=full_text)

    def run(self, skill_name: SkillName | str, ticket_text: str) -> AnalystResult:
        name = SkillName(skill_name) if not isinstance(skill_name, SkillName) else skill_name
        _skill, prompt = self.build(name, ticket_text)
        full_text = call_anthropic(prompt, api_key=self.api_key, model=self.model, base_url=self.base_url)
        return self.parse_response(name, full_text)


def _cli() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m analyst_agent.agent",
        description="Run the standalone Analyst agent against a ticket file.",
    )
    parser.add_argument("--skill", required=True, choices=[s.value for s in SkillName])
    parser.add_argument("--ticket-file", required=True, help="Path to a text file with the ticket content")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Load the skill and build the prompt without calling the LLM (no API key needed)",
    )
    args = parser.parse_args()

    ticket_text = open(args.ticket_file, encoding="utf-8").read()
    agent = AnalystAgent()

    if args.dry_run:
        skill, prompt = agent.build(args.skill, ticket_text)
        print(f"Loaded skill: {skill.name} — {skill.description}")
        print(f"Prompt length: {len(prompt)} chars")
        print("--- prompt preview (first 500 chars) ---")
        print(prompt[:500])
        return 0

    try:
        result = agent.run(args.skill, ticket_text)
    except AnalystAgentError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(result.parsed.model_dump_json(indent=2))
    print(f"\ngate ok={result.gate.ok}", file=sys.stderr)
    for failure in result.gate.failures:
        print(f"  - {failure}", file=sys.stderr)
    return 0 if result.gate.ok else 2


if __name__ == "__main__":
    raise SystemExit(_cli())
