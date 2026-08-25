"""Pydantic models for the Analyst agent's skill outputs.

`RequirementsAnalysisResult` mirrors the JSON contract in
`skills/requirements_analysis/SKILL.md` (ported verbatim from
`src/prompts/agent1_requirement_analyst_v3.md`, the JS pipeline's existing
"Agent 1" prompt) field-for-field, so `validation.py`'s gate logic — itself
ported from `agents/analyst-contract.js` — has something structurally sound
to check.

The other four skills (source/risk/test_gap/root_cause analysis) have no
defined contract yet anywhere in this repo, so their result models are
deliberately minimal placeholders — see each skill's SKILL.md for why.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SkillName(str, Enum):
    SOURCE_ANALYSIS = "source_analysis"
    REQUIREMENTS_ANALYSIS = "requirements_analysis"
    RISK_ANALYSIS = "risk_analysis"
    TEST_GAP_ANALYSIS = "test_gap_analysis"
    ROOT_CAUSE_ANALYSIS = "root_cause_analysis"


# --- requirements_analysis: ported field-for-field from agent1_requirement_analyst_v3.md ---


class UnimplementedRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(..., description="Verbatim ticket line")
    reason: str = Field(..., description="Why it is out of scope / unimplemented")


class AmbiguousAc(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ac_id: Optional[str] = None
    source_line: Optional[str] = Field(
        None, description="Verbatim ticket line when not also in testable_conditions"
    )
    issue: str
    question_for_human: str = Field(
        ..., description="Concrete question — not an invented assumption that patches the gap"
    )


class AnalystReasoning(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticket_read: str = Field(..., description="One sentence")
    unimplemented_rules: list[UnimplementedRule] = Field(default_factory=list)
    ambiguous_acs: list[AmbiguousAc] = Field(default_factory=list)
    rejected_as_non_ac: list[str] = Field(
        default_factory=list,
        description='Each entry: "<verbatim ticket line> — <reason>"',
    )


AcSource = Literal["Business Rules", "Alternative Flow", "Exception Flow"]


class TestableCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(..., description='e.g. "AC-1"')
    source: AcSource
    ac_text: str = Field(..., description="Complete verbatim clause from ticket (>= ~12 characters)")
    roles: list[str] = Field(default_factory=list)
    testable_statement: str = Field(
        ..., description="System MUST [verb] [object] when [trigger] for [role]"
    )
    pass_evidence: str
    fail_evidence: str


PrereqCategory = Literal["data", "environment", "access", "dependency", "knowledge", "other"]
PrereqBlocks = Literal["design", "execution"]


class PrerequisiteItem(BaseModel):
    """Shape shared by blocking and non_blocking prerequisite items.

    `if_not_satisfied` / `must_be_provided_by` are only emitted by the prompt
    for blocking items, so they stay optional here rather than two models.
    """

    model_config = ConfigDict(extra="forbid")
    id: str = Field(..., description="Stable slug from item")
    item: str
    category: PrereqCategory
    blocks: Optional[PrereqBlocks] = None
    expected_shape: Optional[str] = Field(
        None, description='e.g. "url", "api_access", "email", "credentials", "text"'
    )
    derived_from: Optional[str] = Field(None, description="Ticket phrase or 'explicit section'")
    satisfied_by_ticket: bool = False
    if_not_satisfied: Optional[str] = None
    must_be_provided_by: Optional[str] = None


class PrerequisitesNeeded(BaseModel):
    model_config = ConfigDict(extra="forbid")
    blocking: list[PrerequisiteItem] = Field(default_factory=list)
    non_blocking: list[PrerequisiteItem] = Field(default_factory=list)


CoverageGapCategory = Literal[
    "boundary", "negative", "security", "concurrency", "integration", "regression", "performance", "ui"
]
CoverageGapSeverity = Literal["blocking", "non-blocking"]


class CoverageGap(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gap: str = Field(..., description="Description grounded in ticket")
    category: CoverageGapCategory
    severity: CoverageGapSeverity
    suggested_test: str = Field(..., description="One line")


class WhyEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: str = Field(..., description="Only genuinely non-obvious decisions")
    reason: str = Field(..., description="Ticket evidence")
    impact_if_wrong: str


OrchestratorActionKind = Literal["PROCEED", "HOLD", "ASK_HUMAN", "FETCH_DEPENDENCY", "RETRY_WITH_INFO"]


class OrchestratorAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: OrchestratorActionKind
    target: str = Field(..., description="Next agent | human | ticket id")
    detail: str = Field(
        ..., description="Imperative naming the artifact + form (not ticket deficiency)"
    )
    blocking: bool
    requires_value: Optional[bool] = Field(
        None,
        description="Required on ASK_HUMAN/FETCH_DEPENDENCY that expect a typed value",
    )
    prereq_id: Optional[str] = Field(
        None, description="Same id as the prerequisites_needed item this ask is for"
    )
    expected_shape: Optional[str] = None


class ConfidenceLevel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    overall: Literal["high", "medium", "low"]
    reason: str


class AnalystReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    what_i_did: list[str] = Field(default_factory=list, description="At most 2 short lines")
    why: list[WhyEntry] = Field(default_factory=list, description="At most 2 entries; [] ok")
    assumptions_made: list[str] = Field(
        default_factory=list,
        description="Every inference beyond literal ticket text; [] when nothing was assumed",
    )
    orchestrator_actions: list[OrchestratorAction] = Field(default_factory=list)
    confidence: ConfidenceLevel


class RequirementsAnalysisResult(BaseModel):
    """Top-level output of the `requirements_analysis` skill.

    Field-for-field port of the JSON schema in
    `src/prompts/agent1_requirement_analyst_v3.md` / validated on the JS side
    by `validateAnalystOutput` (`src/agents/requirementAnalyst.js`).
    """

    model_config = ConfigDict(extra="forbid")
    success: bool
    analyst_reasoning: AnalystReasoning
    testable_conditions: list[TestableCondition] = Field(default_factory=list)
    prerequisites_needed: PrerequisitesNeeded
    coverage_gaps: list[CoverageGap] = Field(default_factory=list)
    affected_components: list[str] = Field(default_factory=list)
    analysis_complete: bool
    ready_for_test_design: bool
    analyst_report: AnalystReport
    summary: str


# --- placeholder result models for the 4 not-yet-defined skills ---
#
# These skills (source/risk/test_gap/root_cause analysis) have no existing
# contract anywhere in this repo — see each skill's SKILL.md. Keep these
# minimal until someone defines real scope; do not grow them speculatively.


class SourceAnalysisResult(BaseModel):
    """TBD — placeholder only, no defined contract yet."""

    model_config = ConfigDict(extra="forbid")
    summary: str
    findings: list[str] = Field(default_factory=list)


class RiskAnalysisResult(BaseModel):
    """TBD — placeholder only, no defined contract yet."""

    model_config = ConfigDict(extra="forbid")
    summary: str
    findings: list[str] = Field(default_factory=list)


class TestGapAnalysisResult(BaseModel):
    """TBD — placeholder only, no defined contract yet.

    Closest existing analogue: `missing_coverage` / `duplicate_coverage` on
    the QA Reviewer's output (`.cursor/skills/qa-reviewer/SKILL.md`).
    """

    model_config = ConfigDict(extra="forbid")
    summary: str
    findings: list[str] = Field(default_factory=list)


class RootCauseAnalysisResult(BaseModel):
    """TBD — placeholder only, no defined contract yet.

    Closest existing analogue: `root_cause_risk` on the QA Reviewer's output
    (`.cursor/skills/qa-reviewer/SKILL.md`) — a single free-text field there,
    not a distinct analysis phase.
    """

    model_config = ConfigDict(extra="forbid")
    summary: str
    findings: list[str] = Field(default_factory=list)


SKILL_RESULT_MODELS: dict[SkillName, type[BaseModel]] = {
    SkillName.REQUIREMENTS_ANALYSIS: RequirementsAnalysisResult,
    SkillName.SOURCE_ANALYSIS: SourceAnalysisResult,
    SkillName.RISK_ANALYSIS: RiskAnalysisResult,
    SkillName.TEST_GAP_ANALYSIS: TestGapAnalysisResult,
    SkillName.ROOT_CAUSE_ANALYSIS: RootCauseAnalysisResult,
}
