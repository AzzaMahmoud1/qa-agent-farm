"""Post-schema validation gates for Analyst output.

Pydantic (`models.py`) enforces *shape*. Grounding (`grounding.py`) enforces
*traceability*. This module enforces *coherence*: that status, findings,
confidence, and the human-review flag tell a consistent story, and that each
skill's own discipline held.

Each skill's gate is written against the specific way that skill tends to go
wrong — a risk analysis where everything is "critical", a gap analysis that
only ever names one technique, a why-chain that is pure speculation.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .models import (
    ABSTAIN_STATUSES,
    CONFIDENCE_REVIEW_THRESHOLD,
    PRIORITY_ORDER,
    AnalystStatus,
    BaseAnalysisResult,
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
    result: BaseAnalysisResult,
    threshold: float = CONFIDENCE_REVIEW_THRESHOLD,
) -> BaseAnalysisResult:
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
        or any(f.confidence < threshold for f in result.findings())
    )
    if needs_review == result.requires_human_review:
        return result
    return result.model_copy(update={"requires_human_review": needs_review})


def _check_common(result: BaseAnalysisResult, finding_name: str) -> list[str]:
    """Status/finding/confidence coherence shared by every skill."""
    failures: list[str] = []
    findings = result.findings()

    if result.status == AnalystStatus.SUCCESS and not findings:
        failures.append(
            f"status 'success' with zero {finding_name} — use "
            "'insufficient_information' to abstain instead"
        )

    if result.status in ABSTAIN_STATUSES and findings:
        failures.append(
            f"status {result.status.value!r} but {len(findings)} {finding_name} "
            "returned — abstention must not assert findings"
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

    return failures


# --- requirements_analysis --------------------------------------------


def check_requirements_analysis_gate(result: RequirementsAnalysisResult) -> GateResult:
    failures = _check_common(result, "acceptance_criteria")
    return GateResult(ok=not failures, failures=failures)


# --- source_analysis ---------------------------------------------------


def check_source_analysis_gate(result: SourceAnalysisResult) -> GateResult:
    """A "changed surface" with no observable effect is a refactor note, not
    a testable finding — the whole point of this skill is to hand testers
    something they can exercise."""
    failures = _check_common(result, "changed_surfaces")

    for i, surface in enumerate(result.changed_surfaces):
        effect = surface.observable_effect.strip().lower()
        if effect in {"none", "n/a", "nothing", "no change", "-"}:
            failures.append(
                f"changed_surfaces[{i}]: observable_effect is empty ({effect!r}) — "
                "a change with no observable effect is not a testable surface "
                "and should be omitted"
            )
        if surface.change_type == "removed" and not surface.regression_areas:
            failures.append(
                f"changed_surfaces[{i}]: a 'removed' surface must name at least one "
                "regression area — removals are the most common source of silent breakage"
            )

    return GateResult(ok=not failures, failures=failures)


# --- risk_analysis -----------------------------------------------------

#: If every risk lands at the top of the scale the analysis has no signal —
#: prioritization that ranks everything first ranks nothing.
_MAX_CRITICAL_SHARE = 0.5


def check_risk_analysis_gate(result: RiskAnalysisResult) -> GateResult:
    failures = _check_common(result, "risks")

    risks = result.risks
    if len(risks) >= 3:
        top = [r for r in risks if PRIORITY_ORDER[r.priority] >= PRIORITY_ORDER["critical"]]
        if len(top) / len(risks) > _MAX_CRITICAL_SHARE:
            failures.append(
                f"{len(top)}/{len(risks)} risks scored 'critical' — a matrix where "
                "most items are top priority provides no prioritization signal; "
                "re-judge likelihood and impact independently"
            )

    for i, risk in enumerate(risks):
        # The rationale must justify the scoring, not restate the risk.
        if risk.rationale.strip().lower() == risk.risk.strip().lower():
            failures.append(
                f"risks[{i}]: rationale merely restates the risk — it must explain "
                "why this likelihood and this impact"
            )

    return GateResult(ok=not failures, failures=failures)


# --- test_gap_analysis -------------------------------------------------


def check_test_gap_analysis_gate(result: TestGapAnalysisResult) -> GateResult:
    """Guards the most common failure mode: restating the same gap under one
    technique instead of genuinely applying different design lenses."""
    failures = _check_common(result, "gaps")

    gaps = result.gaps
    if len(gaps) >= 4 and len(result.techniques_covered()) == 1:
        only = next(iter(result.techniques_covered()))
        failures.append(
            f"all {len(gaps)} gaps use the same technique ({only!r}) — apply the "
            "other design lenses (boundary, negative, state transition, error "
            "handling) or explain in missing_information why they do not apply"
        )

    seen: dict[tuple[str, str], int] = {}
    for i, gap in enumerate(gaps):
        key = (gap.uncovered_element.strip().lower(), gap.technique)
        if key in seen:
            failures.append(
                f"gaps[{i}] duplicates gaps[{seen[key]}] — same element and technique"
            )
        else:
            seen[key] = i

    return GateResult(ok=not failures, failures=failures)


# --- root_cause_analysis ----------------------------------------------

#: A chain that is entirely speculation is a guess wearing a method's
#: clothing. At least one link must touch real evidence.
_MIN_EVIDENCED_STEPS = 1


def check_root_cause_analysis_gate(result: RootCauseAnalysisResult) -> GateResult:
    failures = _check_common(result, "root_causes")

    for i, cause in enumerate(result.root_causes):
        if not cause.why_chain:
            failures.append(
                f"root_causes[{i}]: why_chain is empty — a root cause asserted "
                "without a chain is an unexplained guess"
            )
            continue

        evidenced = sum(1 for s in cause.why_chain if s.support == "evidenced")
        if evidenced < _MIN_EVIDENCED_STEPS:
            failures.append(
                f"root_causes[{i}]: no step in the why_chain is evidenced — the "
                "entire chain is hypothesis, which cannot support a root-cause claim"
            )

        # A conclusion resting only on speculation must not read as confident.
        if cause.hypothesis_steps > evidenced and cause.confidence >= CONFIDENCE_REVIEW_THRESHOLD:
            failures.append(
                f"root_causes[{i}]: {cause.hypothesis_steps} hypothesis step(s) vs "
                f"{evidenced} evidenced, but confidence is {cause.confidence} — a "
                "mostly-speculative chain cannot be high confidence"
            )

    return GateResult(ok=not failures, failures=failures)


GATE_CHECKS = {
    SkillName.REQUIREMENTS_ANALYSIS: check_requirements_analysis_gate,
    SkillName.SOURCE_ANALYSIS: check_source_analysis_gate,
    SkillName.RISK_ANALYSIS: check_risk_analysis_gate,
    SkillName.TEST_GAP_ANALYSIS: check_test_gap_analysis_gate,
    SkillName.ROOT_CAUSE_ANALYSIS: check_root_cause_analysis_gate,
}
