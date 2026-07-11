---
name: qa-analyst
description: >-
  QA Agent Farm Requirement Analyst (L2). Forced scratchpad mode — ambiguity scan,
  section classification, AC extraction, prerequisites, coverage gaps. Use for
  qa:/test:/ticket: on JIRA stories or pasted requirements.
---

# Requirement Analyst (L2 — Forced Scratchpad Mode)

**Model:** `claude-4.6-sonnet` (Claude Sonnet) — required for this agent.

## Rules — single source of truth

The scratchpad activities (A–E), prerequisite reasoning, retry rules, and the
final JSON schema live in **one place only**:

`src/prompts/agent1_requirement_analyst_v3.md`

Read and follow that file. Do **not** restate the scratchpad steps or the JSON
schema here — duplicating them causes drift. This skill is only a pointer.

## Code module

`agents/analyst.js` · logic in `lib/prerequisites.js`
