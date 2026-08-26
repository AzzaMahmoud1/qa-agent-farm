"""Tests for the four analysis skills beyond requirements extraction.

Each skill's gate is exercised in both directions — it must reject the
failure mode it exists to catch, and accept a sound analysis.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from analyst_agent.grounding import check_grounding
from analyst_agent.models import (
    AnalystStatus,
    RiskAnalysisResult,
    RiskFinding,
    RootCauseAnalysisResult,
    SourceAnalysisResult,
    TestGapAnalysisResult,
    WhyStep,
    derive_priority,
)
from analyst_agent.validation import (
    check_risk_analysis_gate,
    check_root_cause_analysis_gate,
    check_source_analysis_gate,
    check_test_gap_analysis_gate,
)

EVIDENCE = {
    "description": "quantity must be between 1 and 99, and retry the payment request on timeout",
    "diff": [{"hunk": "+    return res.status(429).json({ error: 'rate_limited' })"}],
    "logs": ["TypeError: cannot serialize cart with 51 items"],
}


# --- risk_analysis -----------------------------------------------------


def _risk(**overrides) -> dict:
    base = {
        "risk": "Retried payment requests double-charge the customer.",
        "likelihood": "medium",
        "impact": "high",
        "rationale": "The ticket describes retry-on-timeout with no idempotency key.",
        "evidence_quote": "retry the payment request on timeout",
        "source_field": "description",
        "confidence": 0.8,
    }
    base.update(overrides)
    return base


def _risk_result(risks, **overrides) -> RiskAnalysisResult:
    base = {
        "status": AnalystStatus.SUCCESS,
        "risks": risks,
        "missing_information": [],
        "overall_confidence": 0.8,
        "requires_human_review": False,
    }
    base.update(overrides)
    return RiskAnalysisResult.model_validate(base)


def test_priority_matrix_is_the_standard_3x3():
    assert derive_priority("high", "high") == "critical"
    assert derive_priority("low", "high") == "medium"
    assert derive_priority("high", "low") == "medium"
    assert derive_priority("low", "low") == "minimal"
    assert derive_priority("medium", "medium") == "medium"


def test_priority_is_computed_not_settable():
    """The model judges the axes; it cannot assert a priority directly."""
    with pytest.raises(ValidationError):
        RiskFinding.model_validate(_risk(priority="critical"))


def test_rare_but_severe_risk_ranks_above_common_but_trivial():
    rare_severe = RiskFinding.model_validate(_risk(likelihood="low", impact="high"))
    common_trivial = RiskFinding.model_validate(_risk(likelihood="high", impact="low"))
    # Both land at 'medium' — the point is neither is dismissed for being rare.
    assert rare_severe.priority == "medium"
    assert common_trivial.priority == "medium"


def test_by_priority_orders_highest_first():
    result = _risk_result([
        _risk(risk="low one", likelihood="low", impact="low"),
        _risk(risk="critical one", likelihood="high", impact="high"),
    ])
    assert result.by_priority()[0].risk == "critical one"
    assert result.highest_priority == "critical"


def test_everything_critical_is_rejected():
    """A matrix where most items top out provides no prioritization signal."""
    result = _risk_result([
        _risk(risk=f"risk {i}", likelihood="high", impact="high") for i in range(4)
    ])
    gate = check_risk_analysis_gate(result)
    assert not gate.ok
    assert any("no prioritization signal" in f for f in gate.failures)


def test_mixed_priorities_pass():
    result = _risk_result([
        _risk(risk="a", likelihood="high", impact="high"),
        _risk(risk="b", likelihood="low", impact="low"),
        _risk(risk="c", likelihood="medium", impact="medium"),
    ])
    assert check_risk_analysis_gate(result).ok


def test_rationale_restating_the_risk_is_rejected():
    result = _risk_result([_risk(risk="Payments fail.", rationale="Payments fail.")])
    gate = check_risk_analysis_gate(result)
    assert not gate.ok
    assert any("restates the risk" in f for f in gate.failures)


def test_risk_grounding_is_enforced():
    result = _risk_result([_risk(evidence_quote="a quote that is not in the evidence")])
    assert not check_grounding(result, EVIDENCE).ok


# --- source_analysis ---------------------------------------------------


def _surface(**overrides) -> dict:
    base = {
        "surface": "POST /api/sessions returns 429 when rate limited",
        "change_type": "added",
        "observable_effect": "Clients receive 429 instead of 200 past the limit.",
        "regression_areas": [],
        "evidence_quote": "return res.status(429).json({ error: 'rate_limited' })",
        "source_field": "diff[0].hunk",
        "confidence": 0.9,
    }
    base.update(overrides)
    return base


def _source_result(surfaces, **overrides) -> SourceAnalysisResult:
    base = {
        "status": AnalystStatus.SUCCESS,
        "changed_surfaces": surfaces,
        "missing_information": [],
        "overall_confidence": 0.85,
        "requires_human_review": False,
    }
    base.update(overrides)
    return SourceAnalysisResult.model_validate(base)


def test_surface_with_no_observable_effect_is_rejected():
    """A change nobody can observe is a refactor note, not a testable surface."""
    gate = check_source_analysis_gate(_source_result([_surface(observable_effect="none")]))
    assert not gate.ok
    assert any("not a testable surface" in f for f in gate.failures)


def test_removed_surface_must_name_a_regression_area():
    gate = check_source_analysis_gate(
        _source_result([_surface(change_type="removed", regression_areas=[])])
    )
    assert not gate.ok
    assert any("must name at least one regression area" in f for f in gate.failures)


def test_removed_surface_with_regression_area_passes():
    gate = check_source_analysis_gate(
        _source_result([_surface(change_type="removed", regression_areas=["old clients"])])
    )
    assert gate.ok


def test_valid_source_analysis_passes():
    assert check_source_analysis_gate(_source_result([_surface()])).ok


# --- test_gap_analysis -------------------------------------------------


def _gap(**overrides) -> dict:
    base = {
        "uncovered_element": "quantity field",
        "technique": "boundary_value",
        "gap": "No test covers quantity = 0 or 1.",
        "severity": "medium",
        "suggested_test": "Submit 0, 1, 99, 100 and assert accept/reject.",
        "evidence_quote": "quantity must be between 1 and 99",
        "source_field": "description",
        "confidence": 0.88,
    }
    base.update(overrides)
    return base


def _gap_result(gaps, **overrides) -> TestGapAnalysisResult:
    base = {
        "status": AnalystStatus.SUCCESS,
        "gaps": gaps,
        "missing_information": [],
        "overall_confidence": 0.85,
        "requires_human_review": False,
    }
    base.update(overrides)
    return TestGapAnalysisResult.model_validate(base)


def test_single_technique_across_many_gaps_is_rejected():
    """Applying one lens and stopping is the classic failure mode."""
    result = _gap_result([
        _gap(uncovered_element=f"field {i}", technique="boundary_value") for i in range(4)
    ])
    gate = check_test_gap_analysis_gate(result)
    assert not gate.ok
    assert any("apply the other design lenses" in f for f in gate.failures)


def test_multiple_techniques_pass():
    result = _gap_result([
        _gap(uncovered_element="a", technique="boundary_value"),
        _gap(uncovered_element="b", technique="negative"),
        _gap(uncovered_element="c", technique="state_transition"),
        _gap(uncovered_element="d", technique="error_handling"),
    ])
    assert check_test_gap_analysis_gate(result).ok


def test_duplicate_element_and_technique_is_rejected():
    result = _gap_result([_gap(), _gap()])
    gate = check_test_gap_analysis_gate(result)
    assert not gate.ok
    assert any("duplicates" in f for f in gate.failures)


def test_same_element_different_technique_is_not_a_duplicate():
    result = _gap_result([
        _gap(technique="boundary_value"),
        _gap(technique="negative"),
    ])
    assert check_test_gap_analysis_gate(result).ok


# --- root_cause_analysis ----------------------------------------------


def _step(**overrides) -> dict:
    base = {
        "question": "Why does checkout return 500?",
        "answer": "The serializer raises above 50 items.",
        "support": "evidenced",
        "evidence_quote": "TypeError: cannot serialize cart with 51 items",
        "source_field": "logs[0]",
    }
    base.update(overrides)
    return base


def _cause(**overrides) -> dict:
    base = {
        "symptom": "Checkout returns 500 for large carts.",
        "why_chain": [_step()],
        "root_cause": "The serializer assumes a maximum cart size.",
        "category": "code",
        "evidence_quote": "TypeError: cannot serialize cart with 51 items",
        "source_field": "logs[0]",
        "confidence": 0.8,
    }
    base.update(overrides)
    return base


def _rca_result(causes, **overrides) -> RootCauseAnalysisResult:
    base = {
        "status": AnalystStatus.SUCCESS,
        "root_causes": causes,
        "missing_information": [],
        "overall_confidence": 0.8,
        "requires_human_review": False,
    }
    base.update(overrides)
    return RootCauseAnalysisResult.model_validate(base)


def test_evidenced_step_requires_a_quote():
    """The core anti-laundering rule: you cannot claim evidence without one."""
    with pytest.raises(ValidationError):
        WhyStep.model_validate(_step(evidence_quote=None, source_field=None))


def test_hypothesis_step_must_not_carry_a_quote():
    with pytest.raises(ValidationError):
        WhyStep.model_validate(_step(support="hypothesis"))


def test_hypothesis_step_without_quote_is_valid():
    step = WhyStep.model_validate({
        "question": "Why?", "answer": "Probably a buffer limit.", "support": "hypothesis",
    })
    assert step.support == "hypothesis"


def test_empty_why_chain_is_rejected():
    gate = check_root_cause_analysis_gate(_rca_result([_cause(why_chain=[])]))
    assert not gate.ok
    assert any("unexplained guess" in f for f in gate.failures)


def test_all_hypothesis_chain_is_rejected():
    """A chain of pure speculation cannot support a root-cause claim."""
    speculative = [
        {"question": "Why?", "answer": "Maybe a limit.", "support": "hypothesis"},
        {"question": "Why?", "answer": "Maybe a buffer.", "support": "hypothesis"},
    ]
    gate = check_root_cause_analysis_gate(
        _rca_result([_cause(why_chain=speculative, confidence=0.5)])
    )
    assert not gate.ok
    assert any("entire chain is hypothesis" in f for f in gate.failures)


def test_mostly_speculative_chain_cannot_be_high_confidence():
    chain = [
        _step(),
        {"question": "Why?", "answer": "Maybe a buffer.", "support": "hypothesis"},
        {"question": "Why?", "answer": "Maybe unbounded.", "support": "hypothesis"},
    ]
    gate = check_root_cause_analysis_gate(_rca_result([_cause(why_chain=chain, confidence=0.9)]))
    assert not gate.ok
    assert any("cannot be high confidence" in f for f in gate.failures)


def test_mostly_speculative_chain_at_low_confidence_passes():
    chain = [
        _step(),
        {"question": "Why?", "answer": "Maybe a buffer.", "support": "hypothesis"},
        {"question": "Why?", "answer": "Maybe unbounded.", "support": "hypothesis"},
    ]
    assert check_root_cause_analysis_gate(
        _rca_result([_cause(why_chain=chain, confidence=0.5)])
    ).ok


def test_fabricated_evidenced_step_fails_grounding():
    """A step claiming evidence must have a quote that actually resolves."""
    chain = [_step(evidence_quote="a log line that was never emitted")]
    result = _rca_result([_cause(why_chain=chain)])
    report = check_grounding(result, EVIDENCE)
    assert not report.ok
    assert any("claims to be evidenced" in f for f in report.failures)


def test_hypothesis_steps_are_not_grounding_checked():
    chain = [_step(), {"question": "Why?", "answer": "Speculation.", "support": "hypothesis"}]
    result = _rca_result([_cause(why_chain=chain, confidence=0.7)])
    assert check_grounding(result, EVIDENCE).ok


def test_chain_introspection_helpers():
    chain = [_step(), {"question": "Why?", "answer": "Guess.", "support": "hypothesis"}]
    cause = _rca_result([_cause(why_chain=chain, confidence=0.7)]).root_causes[0]
    assert cause.hypothesis_steps == 1
    assert cause.is_fully_evidenced is False
