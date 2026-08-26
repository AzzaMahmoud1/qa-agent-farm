"""Advisory-by-default for judgment skills.

Grounding verifies that a finding's quote exists — it establishes the
*subject* of a claim. For an extraction skill the quote very nearly is the
claim. For a judgment skill the claim is a predicate hung off the quote
("this is high risk", "this caused that"), which the quote does not support
at all. A model can attach an invented judgment to any loosely-related real
quote and pass every grounding check.

These tests pin that reasoning into behavior: judgment output never routes
onward unreviewed, and extraction output is not penalized for it.
"""

from __future__ import annotations

import pytest

from analyst_agent.dispatch import decide
from analyst_agent.models import (
    SKILL_RESULT_MODELS,
    AnalystStatus,
    RequirementsAnalysisResult,
    RiskAnalysisResult,
    RootCauseAnalysisResult,
    SkillName,
    SourceAnalysisResult,
    TestGapAnalysisResult,
)
from analyst_agent.validation import enforce_confidence_gate

# Evidence that supports a tooltip and nothing more.
THIN_EVIDENCE = {"description": "Add a tooltip to the Save button explaining autosave."}

JUDGMENT_MODELS = [RiskAnalysisResult, TestGapAnalysisResult, RootCauseAnalysisResult]
EXTRACTION_MODELS = [RequirementsAnalysisResult, SourceAnalysisResult]


def _risk(confidence: float = 0.95) -> RiskAnalysisResult:
    return RiskAnalysisResult.model_validate({
        "status": AnalystStatus.SUCCESS,
        "risks": [{
            "risk": "The autosave path can silently corrupt documents under concurrent edits.",
            "likelihood": "high", "impact": "high",
            "rationale": "Autosave is mentioned and concurrency is a known corruption source.",
            "evidence_quote": "Add a tooltip to the Save button explaining autosave",
            "source_field": "description", "confidence": confidence,
        }],
        "missing_information": [], "overall_confidence": confidence,
        "requires_human_review": False,
    })


def _requirements(confidence: float = 0.95) -> RequirementsAnalysisResult:
    return RequirementsAnalysisResult.model_validate({
        "status": AnalystStatus.SUCCESS,
        "acceptance_criteria": [{
            "statement": "A tooltip on the Save button explains autosave.",
            "evidence_quote": "Add a tooltip to the Save button explaining autosave",
            "source_field": "description", "confidence": confidence,
        }],
        "missing_information": [], "overall_confidence": confidence,
        "requires_human_review": False,
    })


# --- which skills are advisory ----------------------------------------


@pytest.mark.parametrize("model", JUDGMENT_MODELS)
def test_judgment_skills_are_advisory(model):
    assert model.ADVISORY is True


@pytest.mark.parametrize("model", EXTRACTION_MODELS)
def test_extraction_skills_are_not_advisory(model):
    assert model.ADVISORY is False


def test_every_skill_declares_a_stance():
    """No skill may silently default — each must be a deliberate choice."""
    for name in SkillName:
        assert isinstance(SKILL_RESULT_MODELS[name].ADVISORY, bool)


def test_not_everything_is_advisory():
    """A flag set on everything carries no information — the same critique
    the risk gate applies to an all-critical matrix."""
    flags = [m.ADVISORY for m in SKILL_RESULT_MODELS.values()]
    assert any(flags) and not all(flags)


# --- the quote-shopping hole this closes ------------------------------


def test_quote_shopped_judgment_no_longer_proceeds():
    """The concrete failure: a real verbatim quote from a tooltip ticket,
    with an invented critical corruption risk hung off it. Grounding and the
    coherence gate both pass it; advisory routing must not."""
    from analyst_agent.grounding import check_grounding
    from analyst_agent.validation import check_risk_analysis_gate

    result = _risk()
    # The failure is real: every content-level gate accepts this.
    assert check_grounding(result, THIN_EVIDENCE).ok
    assert check_risk_analysis_gate(result).ok

    gated = enforce_confidence_gate(result)
    decision = decide(gated)
    assert gated.requires_human_review is True
    assert not decision.has_proceed
    assert decision.is_blocked
    assert "judgment" in decision.rationale


def test_high_confidence_does_not_clear_advisory_review():
    gated = enforce_confidence_gate(_risk(confidence=1.0))
    assert gated.requires_human_review is True
    assert not decide(gated).has_proceed


def test_advisory_hold_explains_why():
    """The block must be legible to whoever reads it, not a bare refusal."""
    detail = decide(enforce_confidence_gate(_risk())).actions[0].detail
    assert "judgment, not an extraction" in detail
    assert "cannot confirm the judgment" in detail


# --- extraction keeps its automation ----------------------------------


def test_extraction_still_proceeds_unreviewed():
    """The trade is scoped to judgment skills; requirements analysis is
    unaffected and still automates."""
    gated = enforce_confidence_gate(_requirements())
    assert gated.requires_human_review is False
    assert decide(gated).has_proceed


def test_extraction_still_blocked_on_low_confidence():
    gated = enforce_confidence_gate(_requirements(confidence=0.4))
    assert gated.requires_human_review is True
    assert not decide(gated).has_proceed


# --- abstention is unaffected -----------------------------------------


def test_advisory_abstention_still_asks_rather_than_holds():
    """Advisory routing applies to findings. An abstaining judgment skill
    still routes as a normal abstention, so the human is told what's
    missing rather than handed an empty advisory."""
    abstained = RiskAnalysisResult.model_validate({
        "status": AnalystStatus.INSUFFICIENT_INFORMATION,
        "risks": [],
        "missing_information": ["The ticket names no behavior specific enough to judge."],
        "overall_confidence": 0.1, "requires_human_review": True,
    })
    decision = decide(enforce_confidence_gate(abstained))
    assert not decision.has_proceed
    assert any(a.action.value == "ASK_HUMAN" for a in decision.actions)
