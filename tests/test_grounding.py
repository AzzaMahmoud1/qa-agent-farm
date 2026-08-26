"""Grounding validation tests — these must prove the gate CATCHES bad
output, not merely that it passes good output."""

from __future__ import annotations

from analyst_agent.grounding import (
    MIN_QUOTE_CHARS,
    check_grounding,
    check_quote_grounded,
    flatten_evidence,
    normalize,
    strip_ungrounded,
    unsupported_claim_count,
)
from analyst_agent.models import AnalystStatus, RequirementsAnalysisResult

EVIDENCE = {
    "key": "QA-1",
    "description": "The system must lock the account after 5 failed attempts.",
    "comments": [{"author": "ba", "body": "Also show a warning at 3 attempts."}],
    "linked_documents": [{"title": "Spec", "body": "Sessions expire after 15 minutes."}],
}


def _result(**criteria_kwargs) -> RequirementsAnalysisResult:
    return RequirementsAnalysisResult(
        status=AnalystStatus.SUCCESS,
        acceptance_criteria=[criteria_kwargs],
        missing_information=[],
        overall_confidence=0.9,
        requires_human_review=False,
    )


# --- flattening --------------------------------------------------------


def test_flatten_produces_indexed_paths():
    flat = flatten_evidence(EVIDENCE)
    assert "description" in flat
    assert "comments[0].body" in flat
    assert "linked_documents[0].body" in flat
    # Parent path also resolves, for whole-field citations.
    assert "comments" in flat


def test_normalize_collapses_whitespace_and_folds_quotes():
    assert normalize("The  cat\nsat") == "the cat sat"
    assert normalize("don’t") == normalize("don't")
    assert normalize("A — B") == normalize("A - B")


# --- the gate must REJECT ungrounded claims ----------------------------


def test_rejects_quote_not_in_evidence():
    result = _result(
        statement="Accounts lock after 10 attempts.",
        evidence_quote="lock the account after 10 failed attempts",
        source_field="description",
        confidence=0.9,
    )
    report = check_grounding(result, EVIDENCE)
    assert not report.ok
    assert report.ungrounded_indices == [0]
    assert "does not appear verbatim" in report.failures[0]


def test_rejects_paraphrase():
    """The quote is a faithful paraphrase — and must still be rejected."""
    result = _result(
        statement="Accounts lock after repeated failures.",
        evidence_quote="the account gets locked following five failed logins",
        source_field="description",
        confidence=0.9,
    )
    report = check_grounding(result, EVIDENCE)
    assert not report.ok


def test_rejects_nonexistent_source_field():
    result = _result(
        statement="Sessions expire.",
        evidence_quote="Sessions expire after 15 minutes.",
        source_field="attachments[3].body",
        confidence=0.9,
    )
    report = check_grounding(result, EVIDENCE)
    assert not report.ok
    assert "does not exist in the evidence" in report.failures[0]


def test_rejects_quote_from_the_wrong_field():
    """Real quote, but attributed to a field it doesn't come from."""
    result = _result(
        statement="Sessions expire after 15 minutes.",
        evidence_quote="Sessions expire after 15 minutes.",
        source_field="description",
        confidence=0.9,
    )
    report = check_grounding(result, EVIDENCE)
    assert not report.ok


def test_rejects_too_short_quote():
    result = _result(
        statement="Something about accounts.",
        evidence_quote="the",
        source_field="description",
        confidence=0.9,
    )
    report = check_grounding(result, EVIDENCE)
    assert not report.ok
    assert "too short" in report.failures[0]
    assert MIN_QUOTE_CHARS > 3


# --- the gate must ACCEPT genuinely grounded claims --------------------


def test_accepts_verbatim_quote():
    result = _result(
        statement="The account locks after 5 failed attempts.",
        evidence_quote="lock the account after 5 failed attempts",
        source_field="description",
        confidence=0.9,
    )
    assert check_grounding(result, EVIDENCE).ok


def test_accepts_quote_from_nested_list_field():
    result = _result(
        statement="A warning appears at 3 attempts.",
        evidence_quote="show a warning at 3 attempts",
        source_field="comments[0].body",
        confidence=0.9,
    )
    assert check_grounding(result, EVIDENCE).ok


def test_accepts_reflowed_whitespace_and_casing():
    result = _result(
        statement="The account locks.",
        evidence_quote="LOCK  THE   ACCOUNT\nAFTER 5 FAILED ATTEMPTS",
        source_field="description",
        confidence=0.9,
    )
    assert check_grounding(result, EVIDENCE).ok


# --- helpers -----------------------------------------------------------


def test_strip_ungrounded_removes_only_bad_criteria():
    result = RequirementsAnalysisResult(
        status=AnalystStatus.SUCCESS,
        acceptance_criteria=[
            {
                "statement": "good",
                "evidence_quote": "lock the account after 5 failed attempts",
                "source_field": "description",
                "confidence": 0.9,
            },
            {
                "statement": "invented",
                "evidence_quote": "accounts are deleted after 30 days",
                "source_field": "description",
                "confidence": 0.9,
            },
        ],
        missing_information=[],
        overall_confidence=0.9,
        requires_human_review=False,
    )
    report = check_grounding(result, EVIDENCE)
    stripped = strip_ungrounded(result, report)
    assert len(stripped.acceptance_criteria) == 1
    assert stripped.acceptance_criteria[0].statement == "good"
    assert unsupported_claim_count(result, EVIDENCE) == 1


def test_empty_criteria_is_trivially_grounded():
    result = RequirementsAnalysisResult(
        status=AnalystStatus.INSUFFICIENT_INFORMATION,
        acceptance_criteria=[],
        missing_information=["nothing stated"],
        overall_confidence=0.1,
        requires_human_review=True,
    )
    report = check_grounding(result, EVIDENCE)
    assert report.ok
    assert report.checked == 0
