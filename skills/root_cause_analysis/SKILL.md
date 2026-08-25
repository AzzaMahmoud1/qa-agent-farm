---
name: root_cause_analysis
description: >-
  PLACEHOLDER — scope not yet defined. Intended to investigate why a test
  failed or a defect occurred, as a distinct analysis step. No implementation
  in this repo yet.
---

# Root cause analysis — placeholder

**Scope is not yet defined in this repo as a distinct step.** The closest
existing analogue is a single free-text field, `root_cause_risk`, on the
**QA Reviewer** agent's output (`.cursor/skills/qa-reviewer/SKILL.md`,
`.claude/skills/qa-reviewer/SKILL.md` once ported) — "Assess impact and
root_cause_risk." That's a one-line judgment call embedded in end-of-pipeline
review, not a dedicated investigative analysis.

This folder exists so the layout matches the intended 5-skill shape
(`analyst_agent/models.py` has a matching `RootCauseAnalysisResult`
placeholder model — `summary` + `findings` only). Do not build real analysis
logic against this stub without first defining:

- What triggers it (a failed Executor result? a reported defect? both?)
- What inputs it needs (execution evidence, logs, the requirements
  breakdown, source diffs — see `source_analysis`, also unscoped)
- Whether it replaces or feeds into the Reviewer's `root_cause_risk` field

Until that's specified, `analyst_agent/validation.py`'s
`check_root_cause_analysis_gate` is a no-op pass-through.
