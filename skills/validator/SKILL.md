---
name: qa-validator
description: >-
  QA Agent Farm output validator (L2). Checks each agent's JSON against role
  guidelines. Use when validating analyst, writer, or data-extractor output in
  the farm pipeline.
---

# Output Validator (L2)

## Role

Check worker output against **that agent's skill rules only**. Never rewrite agent output.

## Attempt limit

- Attempt 1 fail → orchestrator sends **one** corrective re-instruction
- Attempt 2 fail → **brake** — abort entire QA run

## What to validate

| Agent | Key checks |
|-------|------------|
| Analyst | Scratchpad A–E, structured ACs, no metadata as ACs, prerequisites categorized |
| Writer | Given/When/Then, AC coverage, expected_evidence |
| Data Extractor | Dataset per TC, test_oracle, human curl/web alignment, geo bounds |

## Output

Pass/fail with rule-level checks and recommendation for retry.

## Code module

`agents/validator.js`
