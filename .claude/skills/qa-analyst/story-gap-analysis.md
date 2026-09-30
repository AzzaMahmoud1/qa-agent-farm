# Story gap analysis (PO-facing completeness)

The method the analyst applies to find **what the story does not yet say** and
turn each hole into either an Open Question for the PO/BA or a `[Provisional]`
checklist line. Adapted from ISTQB `user-story-gap-analysis`.

This is a **method the analyst uses while writing the breakdown**, not a
separate agent or a grounded JSON pass.

## Not the same as `test_gap_analysis`

| | `analysis/test_gap_analysis` | this (story gap analysis) |
|---|---|---|
| Asks | *What is not tested that should be?* | *What is not stated that testers/devs will need?* |
| Lens | Black-box techniques on the requirements | Completeness of the requirement itself |
| Output | `coverage_gaps` on the contract | Open Questions + `[Provisional]` lines in the breakdown |
| Audience | The test suite | The PO/BA |

Both can run; they answer different questions. Keep the outputs in their own
lanes — coverage technique gaps do not belong in Open Questions, and missing
PO decisions do not belong in `coverage_gaps`.

## Gate

Only meaningful once the story is a usable basis. If `testability_analysis`
returned `NOT_TEST_READY` (≤ 50), the pipeline is already on HOLD — do not mine
for subtle gaps in a story that first needs its fundamentals fixed. Apply this
at `NEEDS_REFINEMENT` and `TEST_READY`.

## Method

1. Map the story: actor, goal, value, in-scope behaviour, explicit AC, stated
   dependencies.
2. Walk the gap dimensions below and ask, for each, what the story leaves
   unanswered.
3. For every gap: name what is missing, why it matters for test/design, and the
   concrete AC or story text that would close it.
4. Route each gap:
   - **Safe conventional default exists** (a wrong guess would only make a test
     provisional, not dangerous) → record it as
     `Default assumption (pending PO): <…>` on the Open Question, and emit a
     matching `[Provisional]` line on the Atomic Requirements Checklist so the
     Writer still covers it.
   - **No safe default** → it stays an Open Question only; no checklist line.
     Never invent the expected result.
5. Prioritise each gap: Must clarify before sprint / Should clarify / Nice.

## Gap dimensions

- **Functional** — alternate flows (cancel, retry, timeout), error messages,
  idempotency / duplicate submission, state transitions.
- **Data & validation** — required vs optional, format / length / charset /
  rounding, empty / null / max volume, invalid reference ids.
- **Roles & permissions** — who may trigger / view / approve; unauthorized and
  forbidden cases.
- **Integration & dependencies** — external systems, APIs, webhooks, queues;
  dependency failure (timeout, 5xx); event ordering, eventual consistency.
- **Non-functional** — performance, security (PII, tokens, rate limits), audit,
  i18n, accessibility — only where the story implies a measurable target.
- **Operational** — logging, metrics, alerts, feature flags, rollback, admin
  tooling.
- **Compliance / domain** — only when the context implies it.

## Question quality

Questions must be specific and decision-forcing.

- **Good:** "If payment fails after the order is created, does the order stay
  Pending or auto-cancel within N minutes?"
- **Weak:** "What about errors?"

## Prioritisation

| Priority | Use when |
|----------|----------|
| Must clarify before sprint | Blocks test design, estimation, or the dev contract |
| Should clarify | An assumption exists but a wrong answer changes behaviour |
| Nice to clarify | Quality improvement; safe to defer to a follow-up story |

## Where the output lands

This method does not add sections to the breakdown — it fills the ones
`qa-analyst/SKILL.md` already defines:

- Gaps with a safe default → **Open Questions From Comments**
  (`Default assumption (pending PO)`) **and** a `[Provisional]` line on the
  **Atomic Requirements Checklist**.
- Gaps without a default → **Open Questions From Comments** only.
- Clarity/ambiguity gaps overlap the **Ambiguity red-flag pass** and the
  **Testability Score & Gate** defects — cross-reference, don't duplicate.
