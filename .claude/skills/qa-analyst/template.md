# Requirements breakdown template

Use these sections in this order. Write "None documented" in an empty section; don't leave it out. Sections marked *(if any)* can be left out when they're empty.

```markdown
# Requirements Breakdown — <ISSUE_ID>
**Story ID:** <ISSUE_ID> · **Project:** <KEY> · **Jira:** <JIRA_BASE>/browse/<ISSUE_ID>
**Summary:** <summary>

## Testability Score & Gate
**Score:** <n>/100 — **<Excellent|Good|Fair|Poor>** · **Verdict:** <TEST_READY|NEEDS_REFINEMENT|NOT_TEST_READY>
**Sections:** User Story <x>/55 · Testability <x>/30 · Requirements <x>/15 · **Knockouts:** <US-3/T-2 or none>

| # | Severity | Location | Issue ("quoted text") | Suggested improvement |
|---|---|---|---|---|

### Red flags *(if any)*
- "<quote>" — <why untestable> → <measurable proposal>

### Recommended PO actions *(when not TEST_READY)*
1. …

> NOT_TEST_READY → stop here. The pipeline is on HOLD.

## Goal
## Pre-conditions
## Post-conditions
## Happy Path
1. <step> → <system action>
## Alternate Flows
### AF01 — <name>
## Error Flows
### EF01 — <name>
## Business Rules
### BR01
## Messages
### MSG01
- EN: "…"
- AR: "…"
## UI / Design Specs
### DM01
| Field/Label (EN) | Field/Label (AR) | Type | Notes |
|---|---|---|---|
## Future Release Items
## Open Questions *(if any)*
- <decision-forcing question> — Priority: Must|Should|Nice — Default assumption (pending PO): <…|none>
## API Scope
<Not applicable | No contract: status codes / request design / response shape (assumed REST) | Full contract: one item per endpoint+method+status>
## UI Scope
<Baseline "UI is designed properly" TC required | Not applicable (backend only)>

## Analyst Reasoning
### Included
### Rejected / non-AC
<"None" if nothing was rejected. Nothing gets dropped without a note.>
### Evidence plan
<What a tester observes: UI state, API status, field value, message copy. No executable steps.>
### Confidence
<high|medium|low> — <reason>

## Atomic Requirements Checklist
1. [AF03] Session is terminated — Reason: observable independently of the redirect — Risk: P0
2. [AF03] DM02 screen is displayed — Reason: the display can fail on its own — Risk: P2
3. [AF03][Provisional] Status becomes "Completed" — Reason: field assertion — Assumption: status value not stated (pending PO) — Risk: P1
4. [UI][Standing] UI is designed properly — Reason: catch-all check of visual fidelity to the design
```
