"""Self-consistency comparison and reconciliation tests."""

from __future__ import annotations

from analyst_agent.consistency import (
    better_grounded,
    compare,
    mutually_supported,
    reconcile,
)
from analyst_agent.models import AnalystStatus, RequirementsAnalysisResult

C_LOCK = {
    "statement": "The account locks after 5 failed attempts.",
    "evidence_quote": "lock the account after 5 failed attempts",
    "source_field": "description",
    "confidence": 0.9,
}
C_WARN = {
    "statement": "A warning appears at 3 attempts.",
    "evidence_quote": "show a warning at 3 attempts",
    "source_field": "comments[0].body",
    "confidence": 0.8,
}


def _result(criteria, **overrides) -> RequirementsAnalysisResult:
    base = {
        "status": AnalystStatus.SUCCESS,
        "acceptance_criteria": criteria,
        "missing_information": [],
        "overall_confidence": 0.9,
        "requires_human_review": False,
    }
    base.update(overrides)
    return RequirementsAnalysisResult.model_validate(base)


# --- comparison ignores cosmetic differences ---------------------------


def test_identical_passes_agree():
    a, b = _result([C_LOCK]), _result([C_LOCK])
    assert compare(a, b).agree


def test_order_and_whitespace_differences_ignored():
    a = _result([C_LOCK, C_WARN])
    reordered = _result([
        C_WARN,
        {**C_LOCK, "statement": "The  account   locks after 5 failed attempts."},
    ])
    assert compare(a, reordered).agree


def test_confidence_jitter_ignored():
    a = _result([{**C_LOCK, "confidence": 0.91}])
    b = _result([{**C_LOCK, "confidence": 0.72}])
    assert compare(a, b).agree


# --- comparison catches material differences ---------------------------


def test_extra_criterion_is_a_disagreement():
    a, b = _result([C_LOCK]), _result([C_LOCK, C_WARN])
    report = compare(a, b)
    assert not report.agree
    assert report.only_in_b == [C_WARN["statement"]]


def test_status_difference_is_a_disagreement():
    a = _result([C_LOCK])
    b = _result([], status=AnalystStatus.INSUFFICIENT_INFORMATION,
                missing_information=["x"], overall_confidence=0.2,
                requires_human_review=True)
    report = compare(a, b)
    assert not report.agree
    assert report.status_conflict


def test_same_claim_different_source_is_a_conflict():
    a = _result([C_LOCK])
    b = _result([{**C_LOCK, "source_field": "comments[0].body"}])
    report = compare(a, b)
    assert not report.agree
    assert report.source_conflicts


# --- reconciliation ----------------------------------------------------


def test_agreement_returns_better_grounded():
    a = _result([{**C_LOCK, "confidence": 0.7}])
    b = _result([{**C_LOCK, "confidence": 0.95}])
    resolved, report = reconcile(a, b)
    assert report.agree
    assert resolved.acceptance_criteria[0].confidence == 0.95
    assert better_grounded(a, b) is b


def test_disagreement_without_verifier_keeps_only_shared_claims():
    a = _result([C_LOCK, C_WARN])
    b = _result([C_LOCK])
    resolved, report = reconcile(a, b, verifier=None)
    assert not report.agree
    statements = [c.statement for c in resolved.acceptance_criteria]
    assert statements == [C_LOCK["statement"]]
    assert resolved.requires_human_review is True


def test_source_conflict_discards_even_the_overlap():
    """A contradiction means we cannot trust the overlap either."""
    a = _result([C_LOCK])
    b = _result([{**C_LOCK, "source_field": "comments[0].body"}])
    resolved, _report = reconcile(a, b, verifier=None)
    assert resolved.status == AnalystStatus.CONFLICTING_EVIDENCE
    assert resolved.acceptance_criteria == []
    assert resolved.requires_human_review is True


def test_no_shared_claims_abstains():
    a = _result([C_LOCK])
    b = _result([C_WARN])
    resolved, _report = reconcile(a, b, verifier=None)
    assert resolved.status == AnalystStatus.INSUFFICIENT_INFORMATION
    assert resolved.acceptance_criteria == []
    assert resolved.requires_human_review is True


def test_verifier_choice_is_used_but_still_flagged():
    a = _result([C_LOCK, C_WARN])
    b = _result([C_LOCK])
    resolved, _report = reconcile(a, b, verifier=lambda x, y: y)
    assert [c.statement for c in resolved.acceptance_criteria] == [C_LOCK["statement"]]
    # Even a confident verifier decision does not clear human review.
    assert resolved.requires_human_review is True


def test_verifier_escalation_falls_back_to_shared():
    a = _result([C_LOCK, C_WARN])
    b = _result([C_LOCK])
    resolved, _report = reconcile(a, b, verifier=lambda x, y: None)
    assert [c.statement for c in resolved.acceptance_criteria] == [C_LOCK["statement"]]
    assert resolved.requires_human_review is True


def test_mutually_supported_takes_conservative_confidence():
    a = _result([{**C_LOCK, "confidence": 0.95}])
    b = _result([{**C_LOCK, "confidence": 0.6}])
    shared = mutually_supported(a, b)
    assert len(shared) == 1
    assert shared[0].confidence == 0.6
