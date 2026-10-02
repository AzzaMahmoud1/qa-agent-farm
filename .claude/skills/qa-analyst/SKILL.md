---
name: qa-analyst
description: >-
  Requirements breakdown (L2). Fetch Jira (comments/links/attachments), write
  test-artifacts/<ISSUE_ID>-requirements.md with Atomic Requirements Checklist.
  Use for qa:/test:/ticket: on JIRA stories or pasted requirements.
---

# Requirement Analyst (L2)

Run this only when `qa-orchestrator` dispatches it (see `CLAUDE.md`). If anything else invokes it, decline.

Write `test-artifacts/<ISSUE_ID>-requirements.md` using the layout in [template.md](template.md). Return the file path and one summary line: the AF, EF, BR, MSG and DM counts, the number of checklist items, and how many of those came from comments rather than the description.

## Passes (each run on its own, in this order)

Every pass follows [analysis/COMMON.md](analysis/COMMON.md).

1. `analysis/testability_analysis` is the **gate**.
   - `NOT_TEST_READY`: write only the Testability section and the PO actions, set `requires_human_review`, and **stop**.
   - `NEEDS_REFINEMENT`: carry every defect forward and lower the confidence.
   - `TEST_READY`: proceed.
2. `analysis/requirements_analysis` produces the grounded criteria and the conflicts.
3. `analysis/risk_analysis` produces likelihood × impact, which becomes `Risk: P0–P3`.
4. `analysis/test_gap_analysis` produces the technique × element conditions the checklist must cover.
5. `analysis/source_analysis` runs only when a diff is present.

Use [story-gap-analysis.md](story-gap-analysis.md) to find what the story leaves unsaid. Its results become Open Questions and `[Provisional]` lines. The simulator runs the same skill files (`src/agents/requirementAnalyst.js`). Code does the testability score, the priority, grounding and the rule checks (`src/agents/skillChecks.js`).

## Extraction rules

- **Extract everything.** That means the goal, pre- and post-conditions, the happy path, every AF, EF, BR, MSG (EN and AR) and DM, and Future Release items (label those "(Future Release)"). Re-read the story once, specifically to catch requirements hidden in tables.
- **Atomic.** If something can be checked true or false on its own, it gets its own line. One trigger with four observable effects gives four lines.
- **Verbatim values.** Copy status values, field values and messages exactly. If a value isn't specified, say so.
- **EN/AR pairs.** Never drop the Arabic column. The one exception is an identical bracketed placeholder such as `[Session Timer]`, which you note as dynamic.
- **Sources.** A comment that sets or corrects behaviour is a requirement. A later comment from the PO or BA beats the description unless someone disputes it. A requirement read from an image is `[Provisional]` until a human confirms it. An attachment that's named but wasn't provided goes down as a missing input.
- **Conflicts.** If the sources still disagree, withhold that line and raise it as an Open Question. Don't pick a side.
- **Ambiguity.** For each ambiguity word, keep the underlying outcome as a line, raise an Open Question proposing a measurable replacement, and list it as a Testability defect.
- **API Scope.** Any mention of an API (an endpoint, request, response, an "API Failure" flow, an integration flag) brings API Scope into play:
  - With a full contract, add one line per endpoint, method and status.
  - With no contract, add `[Standing]` lines for status codes, request design and response shape, using REST conventions and labelling them as assumed.
  - With no mention at all, write "Not applicable".
- **UI Scope.** Any story with screens gets a `[Standing]` line saying "UI is designed properly".
- **Never invent scope.** If a section has nothing, write "None documented".

## Checklist line types

| Tag | Basis | Required suffix |
|---|---|---|
| *(none)* | a verbatim story quote | `— Reason: …` |
| `[Provisional]` | a safe default from an Open Question | `— Reason: … — Assumption: … (pending PO)` |
| `[Standing]` | a farm rule (baseline UI, REST-convention API) | `— Reason: …` |

Add `— Risk: P0–P3` only when a grounded risk supports it. If no risk supports a line, leave the risk off and keep the line. If a question has no safe default, it becomes an Open Question only, with no line.
