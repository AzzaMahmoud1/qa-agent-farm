---
name: qa-writer
description: >-
  Test case writer. Reads requirements breakdown, writes Given/When/Then test
  cases. Never invent requirements from scratch.
---

# Test Case Writer

The writer should locate the output of requirement breakdown; orchestrator should give it to him. If no requirements breakdown exists and none is provided, tell the user to run jira-requirements-breakdown first (or paste/point to the requirements) — do not invent requirements from scratch.

Look for `test-artifacts/<ISSUE_ID>-requirements.md`, or use the path the orchestrator/user provides.

Read the requirements breakdown fully, then write test cases from it.

## Each test case has exactly these fields

| Field | Content |
|-------|---------|
| **Title** | Must start with `Verify that …` |
| **Given** | Starting state / role context |
| **When** | Trigger / action |
| **Then** | Observable outcome — prefer the checklist item's `Reason` evidence guidance and Analyst `pass_evidence`; quote exact EN/AR copy when verifying messages/labels |
| **evidence_citation** | Exact Analyst AC / coverage-gap text this case came from (verbatim clause — no silent paraphrase) |
| **risk** | `P0`–`P3` priority (`probability × impact`). Carry the Analyst checklist item's risk when present; otherwise derive it. Guides execution ordering — see below. |
| **skip_reason** | Required when not writing a TC for an Analyst item |

Write TCs to `test-artifacts/<ISSUE_ID>-test-cases.md`.

## Evidence citation (Analyst rigor baseline)

Every test case **must** cite the exact Analyst `ac_text` or coverage-gap text it
came from (`evidence_citation`). Prefer a complete verbatim clause. Do not present
paraphrase as the citation.

## Explicit verdict — no silent drops

Mirror the Analyst posture rule: every Analyst `testable_conditions[]` item (and
each blocking `coverage_gaps[]` item) gets an explicit verdict in `ac_verdicts`:

- `written` — a test case / outline was produced, **or**
- `skipped` with a non-empty `skip_reason` (e.g. unimplemented_rules)

Never silently drop an Analyst item.

## Retry (one corrective pass)

If integrity checks fail (missing citations or silent drops), retry **once** with
corrective context (failures + compact prior output), mirroring
`runRequirementAnalyst`'s one-retry pattern. Do not loop beyond that.

## Checklist Reasons

Read each Atomic Requirements Checklist line's ` — Reason: …` when drafting GWT
(especially **Then**). Use that evidence guidance; still never invent scope.
One TC per checklist item remains mandatory — Reason is guidance for Then /
evidence, not a second assertion.

## Risk priority (P0–P3)

Assign every test case a `risk` priority so execution can be ordered by severity
(borrowed from a risk-based test-strategy posture):

- Score = **probability × impact**, mapped to `P0` (highest) … `P3` (lowest).
- If the Analyst checklist item carries a risk/severity signal, **carry it
  through** — do not silently re-rate it. Otherwise derive it from the item's
  Reason and business-rule (BR##) weight.
- Business rules (BR##), error flows (EF##), and security/auth conditions skew
  toward `P0`/`P1`. Cosmetic/display-only checks skew toward `P2`/`P3`.
- `risk` is prioritization metadata only — it never justifies dropping a
  required test case. Every mandated item (EN/AR pairs, DM##, API, "UI designed
  properly") still gets its TC regardless of risk.

## Coverage rules

Cover: happy path · alternate flows (AF##) · error flows (EF##) · empty states · language (EN & AR, from MSG##) · UI/viewport (from DM##) · accessibility

Do not skip edge cases or business rules (BR##)

Future Release items → write TCs but note "(Future Release)" in the title

Every documented EN/AR pair gets a test case — none may be skipped. This applies to every message (MSG##) AND every DM## field/button/label that has distinct EN and AR values in the requirements breakdown — not just the obvious chat/error messages. Verify EN and AR together in a single test case (two steps: set language to English and observe, then set language to Arabic and observe) — never split one language pair across two separate test cases. Before finalizing, scan the requirements breakdown's DM## tables specifically for EN/AR columns and confirm every row has a corresponding language TC; this is a common place for coverage to quietly go missing.

Never write a vague Then like "text matches the documented copy." Quote exact EN and AR strings verbatim from the requirements breakdown — e.g. EN: "Session disconnected. Rejoin to continue." / AR: "انقطع الاتصال. يرجى إعادة الانضمام للمتابعة."

One test case = one independently-verifiable assertion. Use the requirements breakdown's "Atomic Requirements Checklist" as your source list — one checklist item should generally map to one test case. Use each item's Reason for Then/evidence wording. Never bundle a business-rule/data-state outcome together with a UI/navigation/display outcome in the same test case.

Any API mention in the requirements breakdown means API test cases are mandatory. Check "API Scope": Not applicable → no API TCs; otherwise cover HTTP status (success + error), request design, and response structure — one assertion per TC.

Every frontend/UI story always gets one "Verify that the UI is designed properly" test case — no exceptions.

## Output format

```markdown
# Test Cases — <ISSUE_ID>

## TC-01
**Title:** Verify that …
**Given:** …
**When:** …
**Then:** …
```
