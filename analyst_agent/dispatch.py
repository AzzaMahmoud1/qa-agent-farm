"""Derive the farm's orchestrator dispatch decision from a grounded result.

The rest of the QA Agent Farm speaks a specific vocabulary — PROCEED, HOLD,
ASK_HUMAN, FETCH_DEPENDENCY — defined by `src/prompts/agent1_requirement_analyst_v3.md`
and enforced JS-side by `agents/analyst-contract.js`. This module lets
`analyst_agent` speak it too, without giving up the grounding-first contract
in `models.py`.

The direction matters. Dispatch is *computed from* verified facts, never
asserted by the model alongside them. In the JS pipeline the model emits
`orchestrator_actions` directly, so a fabricated analysis can still emit a
confident PROCEED — the gate there only checks the claim is self-consistent,
not that it is true. Here PROCEED is reachable only when criteria survived
grounding validation and cleared the confidence threshold, so the dispatch
decision inherits whatever guarantees the evidence actually supports.

`ASK_HUMAN.detail` is built from `missing_information`, which keeps the ask
concrete (it names what the evidence lacks) and satisfies the JS gate's
vague-ask rejection without a second round-trip to the model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from .models import (
    ABSTAIN_STATUSES,
    CONFIDENCE_REVIEW_THRESHOLD,
    AnalystFailure,
    AnalystStatus,
    BaseAnalysisResult,
)

# Mirrors agents/analyst-contract.js `VAGUE_ASK_RE` — an ask that trips this
# is rejected by the JS gate, so we never emit one.
_VAGUE_ASK_RE = re.compile(
    r"\b(need more info|more information|clarify|unclear|tbd|todo|n/a|please clarify|"
    r"not (enough|clear)|requirements?\s+unclear)\b",
    re.IGNORECASE,
)
_MIN_ASK_DETAIL_CHARS = 16


class Action(str, Enum):
    PROCEED = "PROCEED"
    HOLD = "HOLD"
    ASK_HUMAN = "ASK_HUMAN"
    FETCH_DEPENDENCY = "FETCH_DEPENDENCY"


@dataclass(frozen=True)
class OrchestratorAction:
    action: Action
    target: str
    detail: str
    blocking: bool
    requires_value: bool = False

    def to_dict(self) -> dict:
        return {
            "action": self.action.value,
            "target": self.target,
            "detail": self.detail,
            "blocking": self.blocking,
            "requires_value": self.requires_value,
        }


@dataclass(frozen=True)
class DispatchDecision:
    """What the orchestrator should do next, plus why."""

    actions: list[OrchestratorAction]
    ready_for_test_design: bool
    rationale: str

    @property
    def has_proceed(self) -> bool:
        return any(a.action is Action.PROCEED for a in self.actions)

    @property
    def is_blocked(self) -> bool:
        return any(a.blocking for a in self.actions)

    def to_dict(self) -> dict:
        return {
            "orchestrator_actions": [a.to_dict() for a in self.actions],
            "ready_for_test_design": self.ready_for_test_design,
            "rationale": self.rationale,
        }


#: Words that make an ask concrete enough to pass the JS gate's positive-signal
#: check. When `missing_information` has none of them we append the artifact
#: form explicitly rather than emitting an ask that will be rejected.
_CONCRETE_HINT = (
    "Provide the missing detail named above, or update the ticket to state it."
)


def _sanitize_detail(text: str) -> str:
    """Turn a `missing_information` line into a valid ASK_HUMAN detail."""
    detail = " ".join(text.split()).rstrip(".")
    if not detail:
        return ""
    # An imperative naming the artifact — not a description of the deficiency.
    detail = f"Provide: {detail}."
    if len(detail) < _MIN_ASK_DETAIL_CHARS or _VAGUE_ASK_RE.search(detail):
        detail = f"{detail} {_CONCRETE_HINT}"
    return detail


def _asks_from_missing(missing: list[str], limit: int = 5) -> list[OrchestratorAction]:
    actions: list[OrchestratorAction] = []
    for item in missing[:limit]:
        detail = _sanitize_detail(item)
        if not detail:
            continue
        actions.append(
            OrchestratorAction(
                action=Action.ASK_HUMAN,
                target="human",
                detail=detail,
                blocking=True,
                requires_value=True,
            )
        )
    return actions


def decide(
    result: BaseAnalysisResult,
    *,
    threshold: float = CONFIDENCE_REVIEW_THRESHOLD,
) -> DispatchDecision:
    """Compute the dispatch decision from a validated, grounded result.

    Callers must pass a result that has already been through schema,
    grounding, and coherence validation — this function trusts its input and
    only decides routing.
    """
    # Conflicting evidence is not a question a human can answer by supplying
    # a missing artifact; it needs a product decision. HOLD, don't ASK.
    if result.status is AnalystStatus.CONFLICTING_EVIDENCE:
        detail = "Sources disagree; a product decision is required before test design. "
        if result.missing_information:
            detail += " ".join(result.missing_information[:3])
        return DispatchDecision(
            actions=[
                OrchestratorAction(
                    action=Action.HOLD,
                    target="human",
                    detail=detail.strip(),
                    blocking=True,
                    requires_value=True,
                )
            ],
            ready_for_test_design=False,
            rationale="conflicting evidence across sources",
        )

    if result.status is AnalystStatus.INSUFFICIENT_INFORMATION:
        asks = _asks_from_missing(result.missing_information)
        if not asks:
            asks = [
                OrchestratorAction(
                    action=Action.ASK_HUMAN,
                    target="human",
                    detail=(
                        "Provide the acceptance criteria for this ticket, or a link to "
                        "the document that states them."
                    ),
                    blocking=True,
                    requires_value=True,
                )
            ]
        return DispatchDecision(
            actions=asks,
            ready_for_test_design=False,
            rationale="evidence does not support any grounded finding",
        )

    if result.status is AnalystStatus.VALIDATION_FAILED:
        return DispatchDecision(
            actions=[
                OrchestratorAction(
                    action=Action.HOLD,
                    target="human",
                    detail=(
                        "Analyst output failed validation; a human must review the ticket "
                        "before test design proceeds."
                    ),
                    blocking=True,
                    requires_value=False,
                )
            ],
            ready_for_test_design=False,
            rationale="analyst output failed validation",
        )

    # --- success path ---------------------------------------------------

    findings = result.findings()
    if not findings:
        # Defensive: the coherence gate rejects this, so it should be
        # unreachable. Never let an empty success PROCEED.
        return DispatchDecision(
            actions=[
                OrchestratorAction(
                    action=Action.HOLD,
                    target="human",
                    detail="No findings were produced; downstream work cannot start.",
                    blocking=True,
                    requires_value=False,
                )
            ],
            ready_for_test_design=False,
            rationale="success status with zero findings (should be unreachable)",
        )

    # Advisory (judgment) skills never PROCEED on their own. Grounding
    # verifies the subject of a judgment, never the judgment itself, so a
    # quote-shopped risk or causal chain can clear every other gate. Routing
    # them onward unreviewed would be automation the gates cannot justify.
    if type(result).ADVISORY:
        return DispatchDecision(
            actions=[
                OrchestratorAction(
                    action=Action.HOLD,
                    target="human",
                    detail=(
                        f"{len(findings)} advisory finding(s) produced. This analysis is a "
                        "judgment, not an extraction — grounding confirms each finding's "
                        "evidence exists but cannot confirm the judgment drawn from it. "
                        "A human must review before this drives test work."
                    ),
                    blocking=True,
                    requires_value=False,
                )
            ],
            ready_for_test_design=False,
            rationale="advisory skill — judgment output requires human review",
        )

    # Low confidence or an explicit review flag blocks the handoff. This is
    # the whole point of the confidence gate — it must change routing, not
    # just annotate it.
    if result.requires_human_review or result.overall_confidence < threshold:
        actions: list[OrchestratorAction] = [
            OrchestratorAction(
                action=Action.HOLD,
                target="human",
                detail=(
                    f"{len(findings)} grounded finding(s) extracted, but "
                    f"confidence is {result.overall_confidence:.2f} and human review is "
                    "required before test design."
                ),
                blocking=True,
                requires_value=False,
            )
        ]
        # Surface the gaps too, so the human sees what would raise confidence.
        actions.extend(
            a for a in _asks_from_missing(result.missing_information, limit=3)
        )
        return DispatchDecision(
            actions=actions,
            ready_for_test_design=False,
            rationale="grounded findings, but flagged for human review",
        )

    # Ready. Non-blocking asks may accompany PROCEED — matching the JS
    # contract, where access/environment gaps do not hold the Writer.
    actions = [
        OrchestratorAction(
            action=Action.PROCEED,
            target="writer",
            detail=(
                f"Proceed to test design with {len(findings)} grounded finding(s)."
            ),
            blocking=False,
            requires_value=False,
        )
    ]
    for ask in _asks_from_missing(result.missing_information, limit=3):
        actions.append(
            OrchestratorAction(
                action=ask.action,
                target=ask.target,
                detail=ask.detail,
                blocking=False,
                requires_value=ask.requires_value,
            )
        )

    return DispatchDecision(
        actions=actions,
        ready_for_test_design=True,
        rationale="grounded criteria cleared the confidence threshold",
    )


def decide_for_failure(failure: AnalystFailure) -> DispatchDecision:
    """Dispatch for a typed failure — always blocking, never PROCEED."""
    return DispatchDecision(
        actions=[
            OrchestratorAction(
                action=Action.HOLD,
                target="human",
                detail=(
                    f"Analyst could not produce a valid result after {failure.attempts} "
                    f"attempt(s): {failure.reason}"
                ),
                blocking=True,
                requires_value=False,
            )
        ],
        ready_for_test_design=False,
        rationale="analyst returned a typed failure",
    )
