"""Post-schema validation gates for Analyst output.

Pydantic (`models.py`) enforces *shape*. This module enforces *coherence*:
that status, criteria, confidence, and the human-review flag tell a
consistent story, and that low confidence actually gates downstream
behavior rather than being decorative.

Grounding (does each quote really exist in the evidence?) lives separately
in `grounding.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .models import (
    ABSTAIN_STATUSES,
    CONFIDENCE_REVIEW_THRESHOLD,
    AnalystStatus,
    RequirementsAnalysisResult,
    RiskAnalysisResult,
    RootCauseAnalysisResult,
    SkillName,
    SourceAnalysisResult,
    TestGapAnalysisResult,
)


@dataclass
class GateResult:
    ok: bool
    failures: list[str] = field(default_factory=list)

    def __bool__(self) -> bool:
        return self.ok


def enforce_confidence_gate(
    result: RequirementsAnalysisResult,
    threshold: float = CONFIDENCE_REVIEW_THRESHOLD,
) -> RequirementsAnalysisResult:
    """Force `requires_human_review` on when confidence is below threshold.

    Applied in code rather than trusted from the model, so a model that
    reports low confidence but claims no review is needed cannot wave itself
    through. Never flips the flag *off* — a model asking for review always
    gets it.
    """
    needs_review = (
        result.requires_human_review
        or result.overall_confidence < threshold
        or result.status in ABSTAIN_STATUSES
        or any(c.confidence < threshold for c in result.acceptance_criteria)
    )
    if needs_review == result.requires_human_review:
        return result
    return result.model_copy(update={"requires_human_review": needs_review})


def check_requirements_analysis_gate(result: RequirementsAnalysisResult) -> GateResult:
    """Status/criteria/confidence coherence checks."""
    failures: list[str] = []

    if result.status == AnalystStatus.SUCCESS and not result.acceptance_criteria:
        failures.append(
            "status 'success' with zero acceptance_criteria — use "
            "'insufficient_information' to abstain instead"
        )

    if result.status in ABSTAIN_STATUSES and result.acceptance_criteria:
        # Abstaining while still asserting criteria is contradictory: either
        # the evidence supported them or it didn't.
        failures.append(
            f"status {result.status.value!r} but {len(result.acceptance_criteria)} "
            "acceptance_criteria returned — abstention must not assert criteria"
        )

    if result.status == AnalystStatus.INSUFFICIENT_INFORMATION and not result.missing_information:
        failures.append(
            "status 'insufficient_information' requires a non-empty "
            "missing_information list naming what is absent"
        )

    if result.status == AnalystStatus.VALIDATION_FAILED:
        failures.append(
            "model must not self-report 'validation_failed' — that status is "
            "reserved for the harness"
        )

    if result.status in ABSTAIN_STATUSES and not result.requires_human_review:
        failures.append(
            f"status {result.status.value!r} must set requires_human_review true"
        )

    if result.overall_confidence >= CONFIDENCE_REVIEW_THRESHOLD and result.status in ABSTAIN_STATUSES:
        failures.append(
            f"status {result.status.value!r} is inconsistent with high "
            f"overall_confidence ({result.overall_confidence})"
        )

    return GateResult(ok=not failures, failures=failures)


# --- pass-through validators for the 4 placeholder skills ---
#
# No defined contract yet (see models.py) so there's nothing to gate beyond
# what Pydantic already enforces on construction.


def check_source_analysis_gate(result: SourceAnalysisResult) -> GateResult:
    return GateResult(ok=True, failures=[])


def check_risk_analysis_gate(result: RiskAnalysisResult) -> GateResult:
    return GateResult(ok=True, failures=[])


def check_test_gap_analysis_gate(result: TestGapAnalysisResult) -> GateResult:
    return GateResult(ok=True, failures=[])


def check_root_cause_analysis_gate(result: RootCauseAnalysisResult) -> GateResult:
    return GateResult(ok=True, failures=[])


GATE_CHECKS = {
    SkillName.REQUIREMENTS_ANALYSIS: check_requirements_analysis_gate,
    SkillName.SOURCE_ANALYSIS: check_source_analysis_gate,
    SkillName.RISK_ANALYSIS: check_risk_analysis_gate,
    SkillName.TEST_GAP_ANALYSIS: check_test_gap_analysis_gate,
    SkillName.ROOT_CAUSE_ANALYSIS: check_root_cause_analysis_gate,
}
