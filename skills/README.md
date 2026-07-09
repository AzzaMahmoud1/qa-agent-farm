# QA Agent Farm — Skills

Each agent module in `agents/` has a matching skill folder here. Skills define **how the agent thinks and what it must deliver** (for Cursor and the simulator pipeline).

## Agent ↔ Skill ↔ Module

| Agent ID | Skill folder | Code module |
|----------|--------------|-------------|
| `orchestrator` | [orchestrator/](orchestrator/SKILL.md) | [agents/orchestrator.js](../agents/orchestrator.js) |
| `validator` | [validator/](validator/SKILL.md) | [agents/validator.js](../agents/validator.js) |
| `analyst` | [analyst/](analyst/SKILL.md) | [agents/analyst.js](../agents/analyst.js) |
| `writer` | [writer/](writer/SKILL.md) | [agents/writer.js](../agents/writer.js) |
| `test_data_extractor` | [data-extractor/](data-extractor/SKILL.md) | [agents/data-extractor.js](../agents/data-extractor.js) |
| `test_executor` | [executor/](executor/SKILL.md) | [agents/executor.js](../agents/executor.js) |
| `reviewer` | [reviewer/](reviewer/SKILL.md) | [agents/reviewer.js](../agents/reviewer.js) |
| `reporter` | [reporter/](reporter/SKILL.md) | [agents/reporter.js](../agents/reporter.js) |

## Pipeline order

```
Orchestrator → Analyst → Validator → Writer → Data Extractor → Executor → Reviewer → Reporter
```

## Usage in Cursor

Project skills are mirrored under `.cursor/skills/qa-*` for automatic discovery. When running the farm pipeline, load the skill for the active agent before producing output.

Trigger phrases: `qa:`, `test:`, `ticket:`, `write tests for`, `review this ticket`, `test this`
