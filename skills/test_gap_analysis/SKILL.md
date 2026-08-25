---
name: test_gap_analysis
description: >-
  PLACEHOLDER — scope not yet defined. Intended to identify missing or
  duplicate test coverage as a distinct pre-planning step. No implementation
  in this repo yet.
---

# Test gap analysis — placeholder

**Scope is not yet defined in this repo as a distinct step.** The closest
existing analogue is the **QA Reviewer** agent's output fields
(`.cursor/skills/qa-reviewer/SKILL.md`, `.claude/skills/qa-reviewer/SKILL.md`
once ported), which already reports `missing_coverage` and
`duplicate_coverage` — but that happens at the *end* of the pipeline, after
execution, not as an upfront analysis step alongside requirements analysis.

This folder exists so the layout matches the intended 5-skill shape
(`analyst_agent/models.py` has a matching `TestGapAnalysisResult` placeholder
model — `summary` + `findings` only). Do not build real analysis logic
against this stub without first defining:

- Whether this duplicates or supersedes the Reviewer's
  `missing_coverage`/`duplicate_coverage` fields, and if so which one wins
- What it analyzes against (existing test suite? requirements breakdown?
  both?) to find gaps *before* test cases are written, rather than after
- How overlap with the Reviewer's end-of-pipeline coverage check is avoided

Until that's specified, `analyst_agent/validation.py`'s
`check_test_gap_analysis_gate` is a no-op pass-through.
