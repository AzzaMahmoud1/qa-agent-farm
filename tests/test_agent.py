"""Tests for analyst_agent.agent — prompt building and response parsing.
The actual httpx LLM call is never exercised here (no live API key needed)."""

from __future__ import annotations

import json

import pytest

from analyst_agent.agent import AnalystAgent, AnalystAgentError, build_prompt, extract_final_json
from analyst_agent.models import SkillName
from analyst_agent.skills import load_skill

VALID_ANALYST_JSON = {
    "success": True,
    "analyst_reasoning": {
        "ticket_read": "one sentence",
        "unimplemented_rules": [],
        "ambiguous_acs": [],
        "rejected_as_non_ac": [],
    },
    "testable_conditions": [
        {
            "id": "AC-1",
            "source": "Business Rules",
            "ac_text": "When X happens, then Y occurs",
            "roles": ["user"],
            "testable_statement": "System MUST do Y when X",
            "pass_evidence": "Y observed",
            "fail_evidence": "Y not observed",
        }
    ],
    "prerequisites_needed": {"blocking": [], "non_blocking": []},
    "coverage_gaps": [],
    "affected_components": [],
    "analysis_complete": True,
    "ready_for_test_design": True,
    "analyst_report": {
        "what_i_did": ["did the thing"],
        "why": [],
        "assumptions_made": [],
        "orchestrator_actions": [
            {"action": "PROCEED", "target": "writer", "detail": "Proceed to test design", "blocking": False}
        ],
        "confidence": {"overall": "high", "reason": "clear"},
    },
    "summary": "1 testable condition",
}


def test_build_prompt_includes_skill_instructions_and_ticket_text():
    skill = load_skill(SkillName.REQUIREMENTS_ANALYSIS)
    prompt = build_prompt(skill, "As a user I want to log in.")
    assert "Hard rules" in prompt
    assert "As a user I want to log in." in prompt


def test_extract_final_json_takes_the_last_fenced_block():
    text = (
        "scratchpad thoughts here\n"
        "```json\n{\"ignored\": true}\n```\n"
        "more thoughts\n"
        f"```json\n{json.dumps(VALID_ANALYST_JSON)}\n```\n"
    )
    scratchpad, parsed = extract_final_json(text)
    assert "scratchpad thoughts here" in scratchpad
    assert parsed["success"] is True
    assert parsed["summary"] == "1 testable condition"


def test_extract_final_json_raises_when_no_fence():
    with pytest.raises(AnalystAgentError):
        extract_final_json("no json here at all")


def test_parse_response_validates_and_gates():
    agent = AnalystAgent(api_key="unused")
    full_text = f"some scratchpad\n```json\n{json.dumps(VALID_ANALYST_JSON)}\n```\n"
    result = agent.parse_response(SkillName.REQUIREMENTS_ANALYSIS, full_text)
    assert result.gate.ok
    assert result.parsed.summary == "1 testable condition"
    assert result.scratchpad == "some scratchpad"


def test_parse_response_rejects_schema_violation():
    agent = AnalystAgent(api_key="unused")
    bad = dict(VALID_ANALYST_JSON)
    del bad["summary"]  # required field missing
    full_text = f"```json\n{json.dumps(bad)}\n```\n"
    with pytest.raises(AnalystAgentError):
        agent.parse_response(SkillName.REQUIREMENTS_ANALYSIS, full_text)


def test_build_without_api_call_needs_no_key():
    agent = AnalystAgent(api_key="")
    skill, prompt = agent.build(SkillName.REQUIREMENTS_ANALYSIS, "a ticket")
    assert skill.name == "requirements_analysis"
    assert "a ticket" in prompt
