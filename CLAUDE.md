# QA Agent Farm — Claude Code Rules

## Trigger

When a message contains any of: "qa:", "test:", "ticket:", "write tests for",
"review this ticket" — dispatch the QA pipeline by using the Agent tool with
`subagent_type: "qa-orchestrator"`. Do not do the analysis/writing yourself;
hand the run to that subagent.

## Primary pipeline (TC generation)

Analyst (requirements.md with Analyst Reasoning + per-checklist Reason) →
Writer (GWT test cases). Orchestrator must pass the requirements breakdown
path to Writer. If none exists, tell the user to run
jira-requirements-breakdown first — never invent requirements.

Author is **optional execution only** (simulator S2 Plan→Act→Reflect) — not
part of TC generation. Optional execution phase after Writer: Data Extractor →
Author → Executor → Reviewer → Reporter.

## Dependency gate

No worker agent may be assigned or run until its immediate upstream dependency
has returned structured output **and** the Validator has approved that output.
Blocked / non-REVIEW Author does not unlock Executor.

## Dispatch control (orchestrator is the only entry point)

Only the orchestrator (`.claude/agents/qa-orchestrator.md`, `subagent_type:
"qa-orchestrator"`) starts a run and dispatches work. The worker subagents —
analyst, writer, data-extractor, author, executor, reviewer, reporter,
validator — MUST run ONLY when the orchestrator dispatched them (via the Agent
tool) as part of a pipeline run.

If a worker subagent is invoked directly (not dispatched by the orchestrator),
it MUST decline: do no analysis/test/validation work and reply that the run
must be started via the orchestrator using "qa:", "test:", or "ticket:".

## Where the rules live (do not duplicate them here)

- Analyst breakdown → `.claude/skills/qa-analyst/SKILL.md`
  (writes `test-artifacts/<ISSUE_ID>-requirements.md` with Analyst Reasoning
  + per-checklist Reason)
- Writer TCs → `.claude/skills/qa-writer/SKILL.md`
  (reads requirements.md + Reasons; writes `test-artifacts/<ISSUE_ID>-test-cases.md`
  with title / Given / When / Then)
- Author → `.claude/skills/qa-author/SKILL.md` (optional live authoring only)
- Orchestrator handoffs → `.claude/skills/qa-orchestrator/SKILL.md`
- Transitional JSON (simulator/legacy) → `src/prompts/agent1_requirement_analyst_v3.md`
- All other agent rules → `.claude/skills/qa-*/SKILL.md`

## Relationship to Cursor

This project also supports Cursor IDE via `.cursor/agents/*.md` +
`.cursor/skills/qa-*/*.md` + `.cursorrules` — those are untouched by this file
and keep working independently. `.claude/` is an additive mirror of the same
pipeline for Claude Code; edit both sides when the pipeline's rules change.
