"""Pydantic models for the Analyst agent's skill outputs.

`RequirementsAnalysisResult` is the strict output contract every Analyst
response must satisfy. It is deliberately grounding-first: every acceptance
criterion must carry a verbatim `evidence_quote` lifted from the source
text, plus the `source_field` it came from, so `grounding.py` can verify the
claim actually appears in the evidence rather than trusting the model.

`status` makes abstention a first-class, expected outcome — not an error.
A model that lacks grounded detail must return `insufficient_information`
rather than inventing plausible-sounding criteria.

The other four skills (source/risk/test_gap/root_cause analysis) have no
defined contract yet anywhere in this repo, so their result models are
deliberately minimal placeholders — see each skill's SKILL.md for why.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

# Below this overall confidence, `requires_human_review` is forced true by
# `enforce_confidence_gate` in validation.py. Confidence is not decorative.
CONFIDENCE_REVIEW_THRESHOLD = 0.75


class SkillName(str, Enum):
    SOURCE_ANALYSIS = "source_analysis"
    REQUIREMENTS_ANALYSIS = "requirements_analysis"
    RISK_ANALYSIS = "risk_analysis"
    TEST_GAP_ANALYSIS = "test_gap_analysis"
    ROOT_CAUSE_ANALYSIS = "root_cause_analysis"


class AnalystStatus(str, Enum):
    SUCCESS = "success"
    INSUFFICIENT_INFORMATION = "insufficient_information"
    CONFLICTING_EVIDENCE = "conflicting_evidence"
    VALIDATION_FAILED = "validation_failed"


#: Statuses where returning zero acceptance criteria is correct behavior,
#: not a failure. Abstaining is an expected outcome.
ABSTAIN_STATUSES = frozenset(
    {AnalystStatus.INSUFFICIENT_INFORMATION, AnalystStatus.CONFLICTING_EVIDENCE}
)


class AcceptanceCriterion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    statement: str = Field(
        ...,
        min_length=1,
        description="The testable criterion, stated as an assertion about system behavior.",
    )
    evidence_quote: str = Field(
        ...,
        min_length=1,
        description=(
            "Verbatim span copied from the source evidence that supports this "
            "criterion. Must appear character-for-character in the named "
            "source_field — paraphrase is rejected by grounding validation."
        ),
    )
    source_field: str = Field(
        ...,
        min_length=1,
        description="Which evidence field the quote came from (e.g. 'description', 'comments[2]').",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Per-criterion confidence that this criterion is correctly grounded and testable.",
    )


class RequirementsAnalysisResult(BaseModel):
    """Strict output contract for the `requirements_analysis` skill."""

    model_config = ConfigDict(extra="forbid")

    status: AnalystStatus
    acceptance_criteria: list[AcceptanceCriterion] = Field(default_factory=list)
    missing_information: list[str] = Field(
        default_factory=list,
        description="What the evidence would need to contain for a confident answer.",
    )
    overall_confidence: float = Field(..., ge=0.0, le=1.0)
    requires_human_review: bool
    notes: Optional[str] = Field(
        None, description="Optional short free-text context; never a substitute for evidence."
    )


class AnalystFailure(BaseModel):
    """Typed failure returned when the Analyst cannot produce a valid result.

    Returned instead of raising (or worse, passing bad data downstream) when
    schema validation, grounding validation, or retry exhaustion fails.
    """

    model_config = ConfigDict(extra="forbid")

    status: AnalystStatus = AnalystStatus.VALIDATION_FAILED
    reason: str
    failures: list[str] = Field(default_factory=list)
    attempts: int = 0
    requires_human_review: bool = True
    raw_text: Optional[str] = None


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
