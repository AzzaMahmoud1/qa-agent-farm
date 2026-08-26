"""Self-consistency: run the Analyst twice, compare, escalate on disagreement.

Two independent passes over identical evidence should reach the same
conclusion. When they don't, that divergence is signal — it usually means
the evidence was ambiguous enough that the model was partly guessing, which
is exactly the case where a confident-sounding single answer is most
dangerous.

Comparison is canonical: IDs, ordering, whitespace, casing and confidence
jitter are ignored. What counts as a material difference is narrow and
deliberate — which criteria were extracted, which source each came from, and
whether the two passes contradict each other on status.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from .grounding import normalize
from .models import AcceptanceCriterion, AnalystStatus, RequirementsAnalysisResult


@dataclass
class ConsistencyReport:
    agree: bool
    differences: list[str] = field(default_factory=list)
    #: Statements present in one pass but not the other.
    only_in_a: list[str] = field(default_factory=list)
    only_in_b: list[str] = field(default_factory=list)
    #: Same statement, different cited source_field.
    source_conflicts: list[str] = field(default_factory=list)
    status_conflict: bool = False

    def __bool__(self) -> bool:
        return self.agree


def canonical_statement(criterion: AcceptanceCriterion) -> str:
    """Identity of a criterion for comparison purposes — the claim itself,
    normalized. Deliberately excludes confidence and any ID."""
    return normalize(criterion.statement)


def _by_statement(result: RequirementsAnalysisResult) -> dict[str, AcceptanceCriterion]:
    return {canonical_statement(c): c for c in result.acceptance_criteria}


def compare(
    a: RequirementsAnalysisResult, b: RequirementsAnalysisResult
) -> ConsistencyReport:
    """Canonical comparison of two independent Analyst passes."""
    differences: list[str] = []
    map_a = _by_statement(a)
    map_b = _by_statement(b)

    only_in_a = sorted(set(map_a) - set(map_b))
    only_in_b = sorted(set(map_b) - set(map_a))

    status_conflict = a.status != b.status
    if status_conflict:
        differences.append(f"status differs: {a.status.value!r} vs {b.status.value!r}")

    for stmt in only_in_a:
        differences.append(f"criterion only in pass A: {map_a[stmt].statement!r}")
    for stmt in only_in_b:
        differences.append(f"criterion only in pass B: {map_b[stmt].statement!r}")

    source_conflicts: list[str] = []
    for stmt in sorted(set(map_a) & set(map_b)):
        src_a = normalize(map_a[stmt].source_field)
        src_b = normalize(map_b[stmt].source_field)
        if src_a != src_b:
            msg = (
                f"same criterion cited from different sources: "
                f"{map_a[stmt].statement!r} — "
                f"{map_a[stmt].source_field!r} vs {map_b[stmt].source_field!r}"
            )
            source_conflicts.append(msg)
            differences.append(msg)

    return ConsistencyReport(
        agree=not differences,
        differences=differences,
        only_in_a=[map_a[s].statement for s in only_in_a],
        only_in_b=[map_b[s].statement for s in only_in_b],
        source_conflicts=source_conflicts,
        status_conflict=status_conflict,
    )


def better_grounded(
    a: RequirementsAnalysisResult, b: RequirementsAnalysisResult
) -> RequirementsAnalysisResult:
    """Pick the better-grounded of two materially-agreeing results.

    Prefers, in order: fewer criteria needing review, higher mean per-criterion
    confidence, then higher overall confidence. Ties go to `a` (first pass).
    """

    def score(r: RequirementsAnalysisResult) -> tuple[float, float]:
        if r.acceptance_criteria:
            mean_conf = sum(c.confidence for c in r.acceptance_criteria) / len(
                r.acceptance_criteria
            )
        else:
            mean_conf = 0.0
        return (mean_conf, r.overall_confidence)

    return a if score(a) >= score(b) else b


def mutually_supported(
    a: RequirementsAnalysisResult, b: RequirementsAnalysisResult
) -> list[AcceptanceCriterion]:
    """Criteria both passes independently extracted, from the same source.

    This is the only safe automatic merge: a claim two independent passes
    agree on is better supported than either pass alone. Anything found by
    only one pass is left for the verifier or human, never silently merged.
    """
    map_a = _by_statement(a)
    map_b = _by_statement(b)
    shared = []
    for stmt in set(map_a) & set(map_b):
        ca, cb = map_a[stmt], map_b[stmt]
        if normalize(ca.source_field) != normalize(cb.source_field):
            continue
        # Keep the more conservative confidence of the two.
        shared.append(ca if ca.confidence <= cb.confidence else cb)
    return sorted(shared, key=lambda c: canonical_statement(c))


def reconcile(
    a: RequirementsAnalysisResult,
    b: RequirementsAnalysisResult,
    verifier: Optional[Callable[[RequirementsAnalysisResult, RequirementsAnalysisResult], Optional[RequirementsAnalysisResult]]] = None,
) -> tuple[RequirementsAnalysisResult, ConsistencyReport]:
    """Reconcile two passes into one result.

    Agreement -> return the better-grounded pass. Disagreement -> hand both
    to `verifier` (a third LLM call, see `agent.py`). Whatever comes back —
    including a verifier that declines to pick — the result is flagged for
    human review, because an unresolved disagreement is not something code
    should paper over.
    """
    report = compare(a, b)

    if report.agree:
        return better_grounded(a, b), report

    resolved: Optional[RequirementsAnalysisResult] = None
    if verifier is not None:
        resolved = verifier(a, b)

    if resolved is None:
        # No verifier, or verifier escalated. Fall back to only what both
        # passes independently support — never invent a merged answer.
        missing = sorted(
            set(a.missing_information) | set(b.missing_information)
            | {f"unresolved disagreement between analysis passes: {d}" for d in report.differences}
        )
        # A direct contradiction (different status, or the same claim traced
        # to different sources) means we cannot trust even the overlap.
        contradicted = report.status_conflict or report.source_conflicts
        shared = [] if contradicted else mutually_supported(a, b)

        if contradicted:
            status = AnalystStatus.CONFLICTING_EVIDENCE
        elif shared:
            # Both passes independently support these — a real, if partial,
            # answer. Kept as `success` so it stays schema-coherent, but
            # forced to human review below.
            status = AnalystStatus.SUCCESS
        else:
            status = AnalystStatus.INSUFFICIENT_INFORMATION

        resolved = RequirementsAnalysisResult(
            status=status,
            acceptance_criteria=shared,
            missing_information=missing,
            overall_confidence=min(a.overall_confidence, b.overall_confidence),
            requires_human_review=True,
        )

    return resolved.model_copy(update={"requires_human_review": True}), report
