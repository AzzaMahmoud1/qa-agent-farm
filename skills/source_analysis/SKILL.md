---
name: source_analysis
description: >-
  PLACEHOLDER — scope not yet defined. Intended to analyze source code
  (diffs, changed files) as input to QA planning, distinct from the ticket
  text requirements_analysis reads. No implementation in this repo yet.
---

# Source analysis — placeholder

**Scope is not yet defined in this repo.** Nothing in the QA Agent Farm
today performs source-code analysis as a distinct QA step — every existing
Analyst path (`.cursor/skills/qa-analyst/`, `agents/analyst.js`,
`src/agents/requirementAnalyst.js`) reads only ticket text and attachments,
never source code or diffs.

This folder exists so the layout matches the intended 5-skill shape
(`analyst_agent/models.py` has a matching `SourceAnalysisResult` placeholder
model — `summary` + `findings` only). Do not build real analysis logic
against this stub without first defining:

- What input it reads (a diff? a file list? a whole checkout?)
- What questions it's meant to answer (risk surface? affected test areas?
  code smells?)
- How its output feeds the rest of the pipeline (a new prerequisite type for
  `requirements_analysis`? a standalone report?)

Until that's specified, `analyst_agent/validation.py`'s
`check_source_analysis_gate` is a no-op pass-through.
