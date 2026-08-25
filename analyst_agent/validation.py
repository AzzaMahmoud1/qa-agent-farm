"""Ports the Analyst "MAIN GATE" from `agents/analyst-contract.js`
(`checkAnalystPromptContract`) plus the "Gate checklist" section of
`src/prompts/agent1_requirement_analyst_v3.md`.

Same shape as the JS gate: returns `(ok, failures)` rather than raising, so a
caller can see every violation at once instead of stopping at the first one.

Disposition-coverage cross-checking against the raw ticket
(`agents/disposition-coverage.js`, the `story` param in the JS version) is
out of scope here — this only enforces the readiness-signal contract, which
is the part `models.py` gives us a typed object for.
"""

from __future__ import annotations

import re
from typing import Optional

from .models import (
    PrerequisiteItem,
    RequirementsAnalysisResult,
    RiskAnalysisResult,
    RootCauseAnalysisResult,
    SkillName,
    SourceAnalysisResult,
    TestGapAnalysisResult,
)

VAGUE_ASK_RE = re.compile(
    r"\b(need more info|more information|clarify|unclear|tbd|todo|n/a|please clarify|"
    r"not (enough|clear)|requirements?\s+unclear)\b",
    re.IGNORECASE,
)

_POSITIVE_SIGNAL_RE = re.compile(
    r"\b(url|uri|credential|password|token|api|curl|env|environment|staging|uat|role|"
    r"account|username|confirm|provide|supply|decision|ticket|id)\b",
    re.IGNORECASE,
)


class GateResult:
    def __init__(self, ok: bool, failures: list[str]):
        self.ok = ok
        self.failures = failures

    def __bool__(self) -> bool:
        return self.ok

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"GateResult(ok={self.ok}, failures={self.failures!r})"


def _missing_blocking(result: RequirementsAnalysisResult) -> list[PrerequisiteItem]:
    return [b for b in result.prerequisites_needed.blocking if not b.satisfied_by_ticket]


def is_design_blocking_prereq(item: PrerequisiteItem) -> bool:
    """Prefer explicit `blocks`; fall back to category (access/environment
    -> execution only, everything else -> design)."""
    if item.blocks == "design":
        return True
    if item.blocks == "execution":
        return False
    return item.category not in ("access", "environment")


def _design_blocking_missing(result: RequirementsAnalysisResult) -> list[PrerequisiteItem]:
    return [b for b in _missing_blocking(result) if is_design_blocking_prereq(b)]


def is_vague_ask_detail(detail: Optional[str]) -> bool:
    d = (detail or "").strip()
    if len(d) < 16:
        return True
    if VAGUE_ASK_RE.search(d):
        return True
    if not _POSITIVE_SIGNAL_RE.search(d):
        return True
    return False


def check_requirements_analysis_gate(result: RequirementsAnalysisResult) -> GateResult:
    """MAIN GATE — same checks, same order, as `checkAnalystPromptContract`
    in `agents/analyst-contract.js`."""

    failures: list[str] = []

    actions = result.analyst_report.orchestrator_actions
    missing = _missing_blocking(result)
    design_missing = _design_blocking_missing(result)
    has_proceed = any(a.action == "PROCEED" for a in actions)
    blocking_acts = [a for a in actions if a.blocking is True]
    confidence = (result.analyst_report.confidence.overall or "").lower()

    if not actions:
        failures.append(
            "MAIN GATE: orchestrator_actions must be non-empty (Analyst readiness proposal required)"
        )

    if len(result.testable_conditions) == 0 and has_proceed:
        failures.append("MAIN GATE: PROCEED forbidden when testable_conditions is empty")

    if len(result.testable_conditions) == 0 and result.ready_for_test_design is True:
        failures.append(
            "MAIN GATE: ready_for_test_design true forbidden when testable_conditions is empty"
        )

    if result.ready_for_test_design is True and result.analysis_complete is False:
        failures.append("MAIN GATE: ready_for_test_design true requires analysis_complete true")

    if result.ready_for_test_design is True and not has_proceed:
        failures.append("MAIN GATE: ready_for_test_design true requires a PROCEED action")

    if has_proceed and result.ready_for_test_design is not True:
        failures.append("MAIN GATE: PROCEED requires ready_for_test_design true")

    if has_proceed and blocking_acts:
        failures.append("MAIN GATE: cannot emit PROCEED together with blocking orchestrator_actions")

    if has_proceed and design_missing:
        failures.append(
            f"MAIN GATE: PROCEED while {len(design_missing)} design-blocking prerequisite(s) still missing"
        )

    if result.ready_for_test_design is True and design_missing:
        failures.append(
            "MAIN GATE: ready_for_test_design true while design-blocking prerequisites are missing"
        )

    if missing and not blocking_acts and not has_proceed:
        failures.append(
            "MAIN GATE: every missing blocking prerequisite must map to a blocking "
            "ASK_HUMAN / FETCH_DEPENDENCY / HOLD"
        )

    if confidence == "low" and has_proceed:
        failures.append(
            "MAIN GATE: low confidence cannot PROCEED — emit a blocking ASK_HUMAN or HOLD instead"
        )

    for action in actions:
        if action.action != "ASK_HUMAN":
            continue
        if is_vague_ask_detail(action.detail):
            detail_preview = (action.detail or "")[:80]
            failures.append(
                f"MAIN GATE: vague ASK_HUMAN rejected (escalate with a concrete artifact) — "
                f'"{detail_preview}"'
            )

    return GateResult(ok=len(failures) == 0, failures=failures)


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
