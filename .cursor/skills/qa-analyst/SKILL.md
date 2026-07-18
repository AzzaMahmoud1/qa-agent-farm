---
name: qa-analyst
description: >-
  QA Agent Farm Requirement Analyst (L2). Disposition ACs from Business Rules /
  Alternative / Exception Flow; two readiness signals; ask when material is
  missing. Use for qa:/test:/ticket: on JIRA stories or pasted requirements.
---

# Requirement Analyst (L2)

**Model:** `claude-4.6-sonnet` (Claude Sonnet) — required for this agent.

## Rules — single source of truth

Hard rules, readiness signals (`analysis_complete` vs `ready_for_test_design`),
and the final JSON schema live in **one place only**:

`src/prompts/agent1_requirement_analyst_v3.md`

Read and follow that file. Do **not** restate the schema here — duplicating it
causes drift. This skill is only a pointer.

## Code module

`agents/analyst.js` · stub logic in `lib/prerequisites.js`
