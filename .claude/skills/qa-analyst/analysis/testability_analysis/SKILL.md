---
name: testability_analysis
description: >-
  First pass and gate. Judge each ISTQB CTAL-TA §5.2 criterion as met, partial
  or not_met against the story text. Code computes the 0-100 score, the band
  and the verdict.
---

# Testability analysis (the gate)

Judge whether the story is good enough to design tests from. Don't extract requirements and don't write tests. Judge only what the story actually says. If you're torn between `met` and `partial`, choose `partial`.

## Criteria (judge every row)

| ID | Criterion | Weight |
|---|---|---|
| US-1 | Written from the requester's view, not the system internals | 11 |
| US-2 | One clearly defined capability, not several bundled together | 11 |
| **US-3** | Acceptance criteria exist and give an objective pass/fail | 14 |
| US-4 | Has a priority (an explicit value or MoSCoW) | 8 |
| US-5 | Standard format (`As a… I want… so that…`) **or** use-case style with the flows and rules listed (AF/EF/BR tables) | 11 |
| T-1 | Clear: every vague term has a measurable definition | 6 |
| **T-2** | Measurable: whether it's fulfilled can be verified objectively | 8 |
| T-3 | Complete: positive, negative and boundary cases can be derived | 6 |
| T-4 | Consistent: no contradictions, including description vs comments | 5 |
| T-5 | Atomic: one testable unit, or it can be split | 5 |
| R-1 | Unique ID (a Jira key counts) | 3 |
| R-2 | Versioned | 2 |
| R-3 | Traces to a business requirement | 4 |
| R-4 | Traces to an epic, use case or feature | 3 |
| R-5 | Each stated requirement is testable on its own | 3 |

Score missing metadata `not_met`. Never inflate it.

**Code gate.** Score bands are 90 or more Excellent, 75 or more Good (`TEST_READY`), 51–74 Fair (`NEEDS_REFINEMENT`), 50 or less Poor (`NOT_TEST_READY`). If **US-3 or T-2 is `not_met`**, the verdict is `NOT_TEST_READY` whatever the score. A `NOT_TEST_READY` story goes on hold for a human to confirm, and extraction is skipped.

**Defects.** Each defect or red flag quotes the phrase that causes it. Red flags to look for: system-centric wording, ambiguity words, bundled features, acceptance criteria that say *how* instead of *what*, missing acceptance criteria, missing priority. Severity is `critical` (blocks test design), `major` (real ambiguity or missing priority or traceability) or `minor`.

**Tailoring.** For early refinement, score leniently and flag gaps for discussion. For sprint-ready work, require full acceptance criteria, a priority and traceability.

`conflicting_evidence` doesn't apply to this pass, because a contradiction is a T-4 defect. Use `insufficient_information` only when there's nothing to review, such as a title with no body.

## Output

```json
{
  "status": "success | insufficient_information",
  "criteria": [{ "id": "US-3", "result": "met | partial | not_met", "note": "…" }],
  "defects": [{ "severity": "major", "location": "AC #2", "issue": "…", "suggested_improvement": "…", "evidence_quote": "load quickly", "source_field": "description" }],
  "red_flags": [{ "issue": "Untestable state", "evidence_quote": "should load quickly", "source_field": "description" }],
  "missing_information": [],
  "overall_confidence": 0.8,
  "requires_human_review": false
}
```

Don't compute a score or verdict yourself. The code does that from `criteria` (see `src/agents/skillChecks.js`).
