---
name: qa-reporter
description: >-
  QA Agent Farm Report Generator (L5). Builds SEHA-style test summary report
  (DOCX + JSON). Use when pipeline completes or user requests test report.
---

# Report Generator (L5)

**Model:** `claude-4.6-sonnet` (Claude Sonnet) — required for this agent.

## Input

Story metadata, writer test cases, executor results, reviewer score.

## Rules

- Include ticket **key**, **title**, **environment**
- **In Scope**: story title + clickable JIRA link
- Summarize planned vs executed vs passed vs failed vs blocked
- List **regression_rows** with status per test case
- Align metrics with reviewer score
- Output DOCX from `templates/test-summary-report-template.docx`

## Output JSON

```json
{
  "project_name": "SEHA",
  "ticket_key": "SEHJ-XXXX",
  "ticket_title": "...",
  "summary": { "planned": 0, "executed": 0, "passed": 0, "failed": 0, "blocked": 0 },
  "regression_rows": [{ "id": "TC-01", "title": "...", "status": "Planned" }]
}
```

## Code module

`agents/reporter.js` · DOCX: `report-docx.js`
