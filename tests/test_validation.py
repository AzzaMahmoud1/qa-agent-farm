"""Tests for analyst_agent.validation — mirrors the coverage in
agents/analyst-contract.js's own test suite (see test/analyst-contract.js)."""

from __future__ import annotations

from analyst_agent.models import RequirementsAnalysisResult
from analyst_agent.validation import (
    check_requirements_analysis_gate,
    is_design_blocking_prereq,
    is_vague_ask_detail,
)


def _base(**overrides) -> dict:
    base = {
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
    base.update(overrides)
    return base


def _result(**overrides) -> RequirementsAnalysisResult:
    return RequirementsAnalysisResult.model_validate(_base(**overrides))


def test_valid_proceed_passes():
    gate = check_requirements_analysis_gate(_result())
    assert gate.ok
    assert gate.failures == []


def test_empty_acs_cannot_proceed():
    result = _result(
        testable_conditions=[],
        analyst_report={
            "what_i_did": [],
            "why": [],
            "assumptions_made": [],
            "orchestrator_actions": [
                {"action": "PROCEED", "target": "writer", "detail": "Proceed anyway", "blocking": False}
            ],
            "confidence": {"overall": "high", "reason": "n/a"},
        },
    )
    gate = check_requirements_analysis_gate(result)
    assert not gate.ok
    assert any("empty" in f for f in gate.failures)


def test_missing_blocking_prereq_needs_blocking_action():
    result = _result(
        ready_for_test_design=False,
        prerequisites_needed={
            "blocking": [
                {
                    "id": "p1",
                    "item": "some dependency",
                    "category": "dependency",
                    "blocks": "design",
                    "satisfied_by_ticket": False,
                }
            ],
            "non_blocking": [],
        },
        analyst_report={
            "what_i_did": [],
            "why": [],
            "assumptions_made": [],
            # No PROCEED and no blocking action at all — should fail
            "orchestrator_actions": [
                {"action": "HOLD", "target": "human", "detail": "waiting", "blocking": False}
            ],
            "confidence": {"overall": "medium", "reason": "n/a"},
        },
    )
    gate = check_requirements_analysis_gate(result)
    assert not gate.ok
    assert any("must map to a blocking" in f for f in gate.failures)


def test_vague_ask_human_detail_rejected():
    result = _result(
        ready_for_test_design=False,
        prerequisites_needed={
            "blocking": [
                {"id": "p1", "item": "api contract", "category": "dependency", "blocks": "design", "satisfied_by_ticket": False}
            ],
            "non_blocking": [],
        },
        analyst_report={
            "what_i_did": [],
            "why": [],
            "assumptions_made": [],
            "orchestrator_actions": [
                {"action": "ASK_HUMAN", "target": "human", "detail": "need more info", "blocking": True, "prereq_id": "p1"}
            ],
            "confidence": {"overall": "medium", "reason": "n/a"},
        },
    )
    gate = check_requirements_analysis_gate(result)
    assert not gate.ok
    assert any("vague ASK_HUMAN" in f for f in gate.failures)


def test_low_confidence_cannot_proceed():
    result = _result(
        analyst_report={
            "what_i_did": [],
            "why": [],
            "assumptions_made": [],
            "orchestrator_actions": [
                {"action": "PROCEED", "target": "writer", "detail": "Proceed to test design", "blocking": False}
            ],
            "confidence": {"overall": "low", "reason": "material ambiguity"},
        }
    )
    gate = check_requirements_analysis_gate(result)
    assert not gate.ok
    assert any("low confidence" in f for f in gate.failures)


def test_is_design_blocking_prereq_prefers_explicit_blocks():
    designish = {"id": "x", "item": "x", "category": "access", "blocks": "design", "satisfied_by_ticket": False}
    executiony = {"id": "x", "item": "x", "category": "other", "blocks": "execution", "satisfied_by_ticket": False}
    from analyst_agent.models import PrerequisiteItem

    assert is_design_blocking_prereq(PrerequisiteItem.model_validate(designish)) is True
    assert is_design_blocking_prereq(PrerequisiteItem.model_validate(executiony)) is False


def test_is_design_blocking_prereq_falls_back_to_category():
    from analyst_agent.models import PrerequisiteItem

    access_item = {"id": "x", "item": "x", "category": "access", "satisfied_by_ticket": False}
    other_item = {"id": "x", "item": "x", "category": "dependency", "satisfied_by_ticket": False}

    assert is_design_blocking_prereq(PrerequisiteItem.model_validate(access_item)) is False
    assert is_design_blocking_prereq(PrerequisiteItem.model_validate(other_item)) is True


def test_is_vague_ask_detail():
    assert is_vague_ask_detail(None) is True
    assert is_vague_ask_detail("too short") is True
    assert is_vague_ask_detail("This is unclear, please clarify further") is True
    assert (
        is_vague_ask_detail("Provide the staging environment URL and a valid API token for checkout")
        is False
    )
