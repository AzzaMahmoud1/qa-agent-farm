"""Dispatch-layer tests.

The central property: PROCEED is reachable only from a grounded,
confidence-cleared result. Everything else routes to a blocking action.
"""

from __future__ import annotations

import pytest

from analyst_agent.dispatch import (
    Action,
    decide,
    decide_for_failure,
)
from analyst_agent.models import (
    CONFIDENCE_REVIEW_THRESHOLD,
    AnalystFailure,
    AnalystStatus,
    RequirementsAnalysisResult,
)
from analyst_agent.validation import check_requirements_analysis_gate

GOOD_CRITERION = {
    "statement": "The account locks after 5 failed attempts.",
    "evidence_quote": "lock the account after 5 failed attempts",
    "source_field": "description",
    "confidence": 0.92,
}


def _result(**overrides) -> RequirementsAnalysisResult:
    base = {
        "status": AnalystStatus.SUCCESS,
        "acceptance_criteria": [GOOD_CRITERION],
        "missing_information": [],
        "overall_confidence": 0.9,
        "requires_human_review": False,
    }
    base.update(overrides)
    return RequirementsAnalysisResult.model_validate(base)


# --- the success path --------------------------------------------------


def test_grounded_confident_result_proceeds():
    decision = decide(_result())
    assert decision.has_proceed
    assert decision.ready_for_test_design is True
    assert not decision.is_blocked


def test_proceed_targets_the_writer():
    action = next(a for a in decide(_result()).actions if a.action is Action.PROCEED)
    assert action.target == "writer"
    assert action.blocking is False


def test_gaps_accompany_proceed_as_non_blocking():
    """Matching the JS contract: a gap that doesn't prevent writing ACs is
    surfaced but must not hold the Writer."""
    decision = decide(_result(
        missing_information=["the exact lockout duration in minutes"]
    ))
    assert decision.has_proceed
    assert decision.ready_for_test_design is True
    asks = [a for a in decision.actions if a.action is Action.ASK_HUMAN]
    assert asks and all(not a.blocking for a in asks)


# --- PROCEED must be unreachable without grounding ---------------------


def test_insufficient_information_never_proceeds():
    decision = decide(_result(
        status=AnalystStatus.INSUFFICIENT_INFORMATION,
        acceptance_criteria=[],
        missing_information=["the linked spec is not present in the evidence"],
        overall_confidence=0.15,
        requires_human_review=True,
    ))
    assert not decision.has_proceed
    assert decision.is_blocked
    assert decision.ready_for_test_design is False


def test_conflicting_evidence_holds_rather_than_asks():
    """A conflict needs a product decision, not a missing artifact."""
    decision = decide(_result(
        status=AnalystStatus.CONFLICTING_EVIDENCE,
        acceptance_criteria=[],
        missing_information=["30 days in the description vs 90 days in a comment"],
        overall_confidence=0.2,
        requires_human_review=True,
    ))
    assert not decision.has_proceed
    assert [a.action for a in decision.actions] == [Action.HOLD]
    assert "product decision" in decision.actions[0].detail


def test_low_confidence_blocks_even_with_grounded_criteria():
    decision = decide(_result(overall_confidence=0.5, requires_human_review=True))
    assert not decision.has_proceed
    assert decision.is_blocked
    assert decision.ready_for_test_design is False


def test_review_flag_blocks_even_at_high_confidence():
    decision = decide(_result(overall_confidence=0.99, requires_human_review=True))
    assert not decision.has_proceed
    assert decision.is_blocked


def test_confidence_threshold_boundary():
    at = decide(_result(overall_confidence=CONFIDENCE_REVIEW_THRESHOLD))
    below = decide(_result(overall_confidence=CONFIDENCE_REVIEW_THRESHOLD - 0.01))
    assert at.has_proceed
    assert not below.has_proceed


def test_empty_success_cannot_proceed_defensively():
    """The coherence gate rejects this shape, but dispatch must not trust that."""
    bad = RequirementsAnalysisResult.model_construct(
        status=AnalystStatus.SUCCESS,
        acceptance_criteria=[],
        missing_information=[],
        overall_confidence=0.99,
        requires_human_review=False,
        notes=None,
    )
    decision = decide(bad)
    assert not decision.has_proceed
    assert decision.is_blocked


def test_typed_failure_holds():
    decision = decide_for_failure(
        AnalystFailure(reason="validation failed after 2 attempts", attempts=2)
    )
    assert not decision.has_proceed
    assert decision.is_blocked
    assert decision.ready_for_test_design is False


# --- asks must survive the JS gate's vague-ask rejection ---------------


def test_asks_are_concrete_not_vague():
    """agents/analyst-contract.js rejects asks matching its vague regex or
    shorter than 16 chars. Ours must never trip it."""
    from analyst_agent.dispatch import _MIN_ASK_DETAIL_CHARS, _VAGUE_ASK_RE

    decision = decide(_result(
        status=AnalystStatus.INSUFFICIENT_INFORMATION,
        acceptance_criteria=[],
        # Deliberately vague source text — the ask built from it must not be.
        missing_information=["unclear", "TBD"],
        overall_confidence=0.1,
        requires_human_review=True,
    ))
    asks = [a for a in decision.actions if a.action is Action.ASK_HUMAN]
    assert asks
    for ask in asks:
        assert len(ask.detail) >= _MIN_ASK_DETAIL_CHARS
        # The hint appended to vague input makes it concrete.
        assert "Provide" in ask.detail


def test_abstention_with_no_missing_info_still_produces_an_ask():
    decision = decide(_result(
        status=AnalystStatus.INSUFFICIENT_INFORMATION,
        acceptance_criteria=[],
        missing_information=[],
        overall_confidence=0.1,
        requires_human_review=True,
    ))
    asks = [a for a in decision.actions if a.action is Action.ASK_HUMAN]
    assert len(asks) == 1
    assert "acceptance criteria" in asks[0].detail


def test_asks_are_capped():
    many = [f"missing detail number {i}" for i in range(20)]
    decision = decide(_result(
        status=AnalystStatus.INSUFFICIENT_INFORMATION,
        acceptance_criteria=[],
        missing_information=many,
        overall_confidence=0.1,
        requires_human_review=True,
    ))
    assert len([a for a in decision.actions if a.action is Action.ASK_HUMAN]) <= 5


# --- serialization -----------------------------------------------------


def test_to_dict_matches_the_farm_vocabulary():
    payload = decide(_result()).to_dict()
    assert payload["ready_for_test_design"] is True
    action = payload["orchestrator_actions"][0]
    assert set(action) == {"action", "target", "detail", "blocking", "requires_value"}
    assert action["action"] == "PROCEED"


# --- consistency with the coherence gate -------------------------------


@pytest.mark.parametrize("result", [
    _result(),
    _result(status=AnalystStatus.INSUFFICIENT_INFORMATION, acceptance_criteria=[],
            missing_information=["x"], overall_confidence=0.1, requires_human_review=True),
    _result(status=AnalystStatus.CONFLICTING_EVIDENCE, acceptance_criteria=[],
            missing_information=["x"], overall_confidence=0.2, requires_human_review=True),
])
def test_gate_approved_results_all_dispatch_coherently(result):
    """Any result the coherence gate accepts must produce a coherent
    decision: PROCEED iff ready_for_test_design."""
    assert check_requirements_analysis_gate(result).ok
    decision = decide(result)
    assert decision.has_proceed == decision.ready_for_test_design
