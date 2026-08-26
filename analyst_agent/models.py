"""Pydantic models for the Analyst agent's skill outputs.

Every skill shares one shape (`BaseAnalysisResult`): a status that makes
abstention first-class, a confidence score that gates routing, and a list of
findings where **each finding anchors to a verbatim quote** from the source
evidence. `grounding.py` verifies those quotes actually exist.

The four analysis skills beyond requirements extraction are judgment tasks —
risk scoring, gap identification, causal reasoning. That makes them *more*
prone to confident invention, not less, so two extra disciplines apply:

1. Findings separate the grounded anchor (`evidence_quote`) from the claim
   drawn off it, so a reviewer can see the inferential leap.
2. Derived values are computed in code, never asserted by the model — see
   `RiskFinding.priority`, which is a pure function of likelihood x impact
   rather than a field the model fills in.
"""

from __future__ import annotations

from enum import Enum
from typing import ClassVar, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


#: Statuses where returning zero findings is correct behavior, not a failure.
ABSTAIN_STATUSES = frozenset(
    {AnalystStatus.INSUFFICIENT_INFORMATION, AnalystStatus.CONFLICTING_EVIDENCE}
)


class GroundedFinding(BaseModel):
    """Base for every finding: an anchor into the real evidence.

    `evidence_quote` must appear character-for-character in `source_field`.
    Paraphrase is rejected by `grounding.check_grounding`.
    """

    model_config = ConfigDict(extra="forbid")

    evidence_quote: str = Field(
        ...,
        min_length=1,
        description="Verbatim span copied from source_field. Paraphrase is rejected.",
    )
    source_field: str = Field(
        ...,
        min_length=1,
        description="Evidence field the quote came from, e.g. 'description', 'diff[2].hunk'.",
    )
    confidence: float = Field(..., ge=0.0, le=1.0)

    def identity(self) -> str:
        """What makes this finding *the same finding* across two independent
        passes. Used by `consistency.py` to compare runs while ignoring
        wording, ordering, and confidence jitter. Subclasses override with
        their own claim field(s)."""
        return self.evidence_quote


class BaseAnalysisResult(BaseModel):
    """Shape shared by every skill's output."""

    model_config = ConfigDict(extra="forbid")

    #: True for skills whose output is a *judgment* rather than an extraction.
    #:
    #: Grounding verifies that a finding's quote exists in the evidence — it
    #: proves the finding's *subject* is real. For an extraction skill the
    #: quote very nearly is the claim, so that is close to sufficient. For a
    #: judgment skill the claim is a predicate hung off the quote ("this is
    #: high risk", "this caused that"), which the quote does not establish at
    #: all. A model can pick any loosely-related real quote and attach an
    #: invented judgment to it, and every grounding check still passes.
    #:
    #: Self-consistency catches the divergent case (two passes invent
    #: different things), but is blind to the convergent one — two passes
    #: making the same plausible leap read as agreement.
    #:
    #: So advisory results never route onward unreviewed, regardless of how
    #: confident the model is. This is a deliberate trade of automation for
    #: honesty about what the gates can actually guarantee.
    ADVISORY: ClassVar[bool] = False

    status: AnalystStatus
    missing_information: list[str] = Field(
        default_factory=list,
        description="What the evidence would need to contain for a confident answer.",
    )
    overall_confidence: float = Field(..., ge=0.0, le=1.0)
    requires_human_review: bool
    notes: Optional[str] = Field(
        None, description="Optional short context; never a substitute for evidence."
    )

    def findings(self) -> list[GroundedFinding]:
        """The skill's findings, for generic grounding validation."""
        return []

    def with_findings(self, findings: list) -> "BaseAnalysisResult":
        """Return a copy carrying a replaced findings list."""
        return self


# --- requirements_analysis --------------------------------------------


class AcceptanceCriterion(GroundedFinding):
    statement: str = Field(
        ...,
        min_length=1,
        description="The testable criterion, as an assertion about system behavior.",
    )

    def identity(self) -> str:
        return self.statement


class RequirementsAnalysisResult(BaseAnalysisResult):
    acceptance_criteria: list[AcceptanceCriterion] = Field(default_factory=list)

    def findings(self) -> list[GroundedFinding]:
        return list(self.acceptance_criteria)

    def with_findings(self, findings: list) -> "RequirementsAnalysisResult":
        return self.model_copy(update={"acceptance_criteria": findings})


# --- source_analysis (change impact analysis) -------------------------

ChangeType = Literal["added", "modified", "removed", "behavioral", "config", "dependency"]


class ChangedSurface(GroundedFinding):
    """One externally-observable surface affected by the change.

    "Surface" means something a tester can exercise — an endpoint, a screen,
    a CLI flag, a message, a stored field. Internal refactors with no
    observable surface are deliberately out of scope.
    """

    surface: str = Field(..., min_length=1, description="What changed, in testable terms.")
    change_type: ChangeType
    observable_effect: str = Field(
        ...,
        min_length=1,
        description="What a tester would see differently. If nothing, it is not a surface.",
    )
    regression_areas: list[str] = Field(
        default_factory=list,
        description="Existing behavior this change could break, named only when the evidence implies it.",
    )

    def identity(self) -> str:
        return self.surface


class SourceAnalysisResult(BaseAnalysisResult):
    changed_surfaces: list[ChangedSurface] = Field(default_factory=list)

    def findings(self) -> list[GroundedFinding]:
        return list(self.changed_surfaces)

    def with_findings(self, findings: list) -> "SourceAnalysisResult":
        return self.model_copy(update={"changed_surfaces": findings})


# --- risk_analysis (risk-based testing) -------------------------------

RiskLevel = Literal["low", "medium", "high"]
RiskPriority = Literal["minimal", "low", "medium", "high", "critical"]

#: Standard 3x3 likelihood x impact matrix. Computed, never model-asserted —
#: the model judges the two axes; the priority follows deterministically.
_PRIORITY_MATRIX: dict[tuple[str, str], RiskPriority] = {
    ("low", "low"): "minimal",
    ("low", "medium"): "low",
    ("low", "high"): "medium",
    ("medium", "low"): "low",
    ("medium", "medium"): "medium",
    ("medium", "high"): "high",
    ("high", "low"): "medium",
    ("high", "medium"): "high",
    ("high", "high"): "critical",
}

PRIORITY_ORDER: dict[str, int] = {
    "minimal": 0, "low": 1, "medium": 2, "high": 3, "critical": 4,
}


def derive_priority(likelihood: str, impact: str) -> RiskPriority:
    """Pure lookup — the risk matrix, applied in code.

    Keeping this out of the model's hands means a model cannot inflate a
    low/low risk into "critical" to sound thorough.
    """
    return _PRIORITY_MATRIX[(likelihood, impact)]


class RiskFinding(GroundedFinding):
    risk: str = Field(
        ..., min_length=1, description="What could fail, stated as a concrete failure mode."
    )
    likelihood: RiskLevel = Field(..., description="How likely this failure is.")
    impact: RiskLevel = Field(..., description="Severity if it does fail.")
    rationale: str = Field(
        ...,
        min_length=1,
        description="Why these two levels, tied to the quoted evidence.",
    )
    suggested_test: Optional[str] = Field(
        None, description="One line — how a tester would probe this risk."
    )

    def identity(self) -> str:
        return self.risk

    @property
    def priority(self) -> RiskPriority:
        """Derived from the matrix, not asserted by the model."""
        return derive_priority(self.likelihood, self.impact)


class RiskAnalysisResult(BaseAnalysisResult):
    ADVISORY: ClassVar[bool] = True

    risks: list[RiskFinding] = Field(default_factory=list)

    def findings(self) -> list[GroundedFinding]:
        return list(self.risks)

    def with_findings(self, findings: list) -> "RiskAnalysisResult":
        return self.model_copy(update={"risks": findings})

    def by_priority(self) -> list[RiskFinding]:
        return sorted(self.risks, key=lambda r: -PRIORITY_ORDER[r.priority])

    @property
    def highest_priority(self) -> Optional[RiskPriority]:
        ranked = self.by_priority()
        return ranked[0].priority if ranked else None


# --- test_gap_analysis -------------------------------------------------

#: Standard black-box test design techniques. A gap is always expressed as
#: "this technique is unapplied to that element" rather than a vague feeling
#: that coverage is thin.
GapTechnique = Literal[
    "equivalence_partition",
    "boundary_value",
    "negative",
    "state_transition",
    "decision_table",
    "error_handling",
    "integration",
    "regression",
    "accessibility",
    "localization",
]

GapSeverity = Literal["low", "medium", "high"]


class TestGap(GroundedFinding):
    uncovered_element: str = Field(
        ...,
        min_length=1,
        description="The specific requirement, input, or state that lacks coverage.",
    )
    technique: GapTechnique = Field(
        ..., description="Which test design technique is unapplied to it."
    )
    gap: str = Field(..., min_length=1, description="What is untested, concretely.")
    severity: GapSeverity
    suggested_test: str = Field(..., min_length=1, description="One line.")

    def identity(self) -> str:
        # Same element under a different technique is a different gap.
        return f"{self.uncovered_element}::{self.technique}"


class TestGapAnalysisResult(BaseAnalysisResult):
    ADVISORY: ClassVar[bool] = True

    gaps: list[TestGap] = Field(default_factory=list)

    def findings(self) -> list[GroundedFinding]:
        return list(self.gaps)

    def with_findings(self, findings: list) -> "TestGapAnalysisResult":
        return self.model_copy(update={"gaps": findings})

    def techniques_covered(self) -> set[str]:
        return {g.technique for g in self.gaps}


# --- root_cause_analysis ----------------------------------------------

#: Ishikawa (fishbone) categories, adapted from the manufacturing "6 Ms" to
#: software: Machine->environment, Material->data, Method->process,
#: Measurement->observability, Man->people, plus code as its own category.
CauseCategory = Literal[
    "code", "data", "environment", "process", "observability", "people", "external_dependency"
]

#: Whether a step in the why-chain rests on evidence or is a hypothesis.
#: This is the single most important field in this model — it marks exactly
#: where the evidence stops and the reasoning starts.
StepSupport = Literal["evidenced", "hypothesis"]


class WhyStep(BaseModel):
    """One link in a 5-Whys chain."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(..., min_length=1, description='e.g. "Why did the request time out?"')
    answer: str = Field(..., min_length=1)
    support: StepSupport = Field(
        ...,
        description=(
            "'evidenced' requires a verbatim quote; 'hypothesis' is an unproven "
            "inference and must be labelled as one."
        ),
    )
    evidence_quote: Optional[str] = None
    source_field: Optional[str] = None

    @model_validator(mode="after")
    def _evidenced_steps_need_a_quote(self) -> "WhyStep":
        if self.support == "evidenced" and not (self.evidence_quote and self.source_field):
            raise ValueError(
                "a step marked 'evidenced' must supply both evidence_quote and source_field"
            )
        if self.support == "hypothesis" and self.evidence_quote:
            raise ValueError(
                "a step marked 'hypothesis' must not carry an evidence_quote — "
                "label it 'evidenced' if it is actually supported"
            )
        return self


class RootCause(GroundedFinding):
    symptom: str = Field(..., min_length=1, description="The observed failure, as reported.")
    why_chain: list[WhyStep] = Field(
        default_factory=list,
        description="5-Whys chain from symptom to cause; each step labelled evidenced or hypothesis.",
    )
    root_cause: str = Field(..., min_length=1)
    category: CauseCategory
    corrective_action: Optional[str] = Field(
        None, description="What would prevent recurrence. Omit rather than guess."
    )

    def identity(self) -> str:
        return self.root_cause

    @property
    def hypothesis_steps(self) -> int:
        return sum(1 for s in self.why_chain if s.support == "hypothesis")

    @property
    def is_fully_evidenced(self) -> bool:
        return bool(self.why_chain) and self.hypothesis_steps == 0


class RootCauseAnalysisResult(BaseAnalysisResult):
    ADVISORY: ClassVar[bool] = True

    root_causes: list[RootCause] = Field(default_factory=list)

    def findings(self) -> list[GroundedFinding]:
        return list(self.root_causes)

    def with_findings(self, findings: list) -> "RootCauseAnalysisResult":
        return self.model_copy(update={"root_causes": findings})


# --- failure -----------------------------------------------------------


class AnalystFailure(BaseModel):
    """Typed failure returned when the Analyst cannot produce a valid result."""

    model_config = ConfigDict(extra="forbid")

    status: AnalystStatus = AnalystStatus.VALIDATION_FAILED
    reason: str
    failures: list[str] = Field(default_factory=list)
    attempts: int = 0
    requires_human_review: bool = True
    raw_text: Optional[str] = None


SKILL_RESULT_MODELS: dict[SkillName, type[BaseAnalysisResult]] = {
    SkillName.REQUIREMENTS_ANALYSIS: RequirementsAnalysisResult,
    SkillName.SOURCE_ANALYSIS: SourceAnalysisResult,
    SkillName.RISK_ANALYSIS: RiskAnalysisResult,
    SkillName.TEST_GAP_ANALYSIS: TestGapAnalysisResult,
    SkillName.ROOT_CAUSE_ANALYSIS: RootCauseAnalysisResult,
}
