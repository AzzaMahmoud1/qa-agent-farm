"""Status/confidence coherence gate tests.

Each gate is exercised in both directions: it must reject the incoherent
case AND accept the coherent one.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from analyst_agent.models import (
    CONFIDENCE_REVIEW_THRESHOLD,
    AnalystStatus,
    RequirementsAnalysisResult,
)
from analyst_agent.validation import check_requirements_analysis_gate, enforce_confidence_gate

GOOD_CRITERION = {
    "statement": "The account locks after 5 failed attempts.",
    "evidence_quote": "lock the account after 5 failed attempts",
    "source_field": "description",
    "confidence": 0.9,
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


# --- schema-level enforcement (Pydantic) -------------------------------


def test_confidence_out_of_range_rejected():
    with pytest.raises(ValidationError):
        _result(overall_confidence=1.4)


def test_unknown_field_rejected():
    with pytest.raises(ValidationError):
        RequirementsAnalysisResult.model_validate({
            "status": "success",
            "acceptance_criteria": [GOOD_CRITERION],
            "overall_confidence": 0.9,
            "requires_human_review": False,
            "hallucinated_extra_field": "surprise",
        })


def test_criterion_missing_evidence_quote_rejected():
    with pytest.raises(ValidationError):
        _result(acceptance_criteria=[{
            "statement": "no quote provided",
            "source_field": "description",
            "confidence": 0.9,
        }])


# --- coherence gate: must REJECT ---------------------------------------


def test_success_with_zero_criteria_rejected():
    gate = check_requirements_analysis_gate(_result(acceptance_criteria=[]))
    assert not gate.ok
    assert "zero acceptance_criteria" in gate.failures[0]


def test_abstain_while_asserting_criteria_rejected():
    gate = check_requirements_analysis_gate(_result(
        status=AnalystStatus.INSUFFICIENT_INFORMATION,
        missing_information=["something"],
        overall_confidence=0.2,
        requires_human_review=True,
    ))
    assert not gate.ok
    assert any("must not assert findings" in f for f in gate.failures)


def test_insufficient_information_without_missing_info_rejected():
    gate = check_requirements_analysis_gate(_result(
        status=AnalystStatus.INSUFFICIENT_INFORMATION,
        acceptance_criteria=[],
        missing_information=[],
        overall_confidence=0.2,
        requires_human_review=True,
    ))
    assert not gate.ok
    assert any("missing_information" in f for f in gate.failures)


def test_model_self_reporting_validation_failed_rejected():
    gate = check_requirements_analysis_gate(_result(
        status=AnalystStatus.VALIDATION_FAILED,
        acceptance_criteria=[],
        overall_confidence=0.2,
        requires_human_review=True,
    ))
    assert not gate.ok
    assert any("reserved for the harness" in f for f in gate.failures)


def test_abstain_without_human_review_rejected():
    gate = check_requirements_analysis_gate(_result(
        status=AnalystStatus.CONFLICTING_EVIDENCE,
        acceptance_criteria=[],
        missing_information=["conflict"],
        overall_confidence=0.2,
        requires_human_review=False,
    ))
    assert not gate.ok
    assert any("requires_human_review true" in f for f in gate.failures)


def test_abstain_with_high_confidence_rejected():
    gate = check_requirements_analysis_gate(_result(
        status=AnalystStatus.CONFLICTING_EVIDENCE,
        acceptance_criteria=[],
        missing_information=["conflict"],
        overall_confidence=0.95,
        requires_human_review=True,
    ))
    assert not gate.ok
    assert any("inconsistent with high" in f for f in gate.failures)


# --- coherence gate: must ACCEPT ---------------------------------------


def test_valid_success_passes():
    gate = check_requirements_analysis_gate(_result())
    assert gate.ok


def test_valid_abstention_passes():
    gate = check_requirements_analysis_gate(_result(
        status=AnalystStatus.INSUFFICIENT_INFORMATION,
        acceptance_criteria=[],
        missing_information=["The linked spec is not present in the evidence."],
        overall_confidence=0.15,
        requires_human_review=True,
    ))
    assert gate.ok, gate.failures


def test_valid_conflict_passes():
    gate = check_requirements_analysis_gate(_result(
        status=AnalystStatus.CONFLICTING_EVIDENCE,
        acceptance_criteria=[],
        missing_information=["30 days vs 90 days"],
        overall_confidence=0.2,
        requires_human_review=True,
    ))
    assert gate.ok, gate.failures


# --- confidence gate is enforced in code, not trusted ------------------


def test_low_overall_confidence_forces_human_review():
    result = _result(overall_confidence=0.5, requires_human_review=False)
    gated = enforce_confidence_gate(result)
    assert gated.requires_human_review is True


def test_low_per_criterion_confidence_forces_human_review():
    result = _result(
        overall_confidence=0.95,
        requires_human_review=False,
        acceptance_criteria=[{**GOOD_CRITERION, "confidence": 0.4}],
    )
    gated = enforce_confidence_gate(result)
    assert gated.requires_human_review is True


def test_high_confidence_leaves_flag_alone():
    result = _result(overall_confidence=0.95, requires_human_review=False)
    assert enforce_confidence_gate(result).requires_human_review is False


def test_gate_never_turns_review_off():
    """A model asking for review always gets it, even at high confidence."""
    result = _result(overall_confidence=0.99, requires_human_review=True)
    assert enforce_confidence_gate(result).requires_human_review is True


def test_threshold_boundary():
    at_threshold = _result(
        overall_confidence=CONFIDENCE_REVIEW_THRESHOLD, requires_human_review=False
    )
    below = _result(
        overall_confidence=CONFIDENCE_REVIEW_THRESHOLD - 0.01, requires_human_review=False
    )
    assert enforce_confidence_gate(at_threshold).requires_human_review is False
    assert enforce_confidence_gate(below).requires_human_review is True
