# Story gap analysis (completeness, for the PO)

Find **what the story doesn't say** that testers or developers will need. This isn't the same as `analysis/test_gap_analysis`, which asks which technique each element needs. This file asks which decisions are missing. Skip it when the story is `NOT_TEST_READY`.

**Dimensions to walk through:**
- functional: cancel, retry, timeout, duplicate submit, state changes
- data: required fields, format, length, empty, max, invalid ids
- roles and permissions: unauthorised and forbidden cases
- integrations: dependency failures, event ordering
- non-functional: performance, security, i18n, accessibility, but only where a target is implied
- operational: logging, flags, rollback
- compliance: only when the context implies it

**For each gap:**
1. Ask one question that forces a decision. A good one: "If payment fails after the order is created, does the order stay Pending or auto-cancel?" A weak one: "What about errors?"
2. Set a priority: **Must** (blocks test design or the dev contract), **Should** (a wrong assumption would change behaviour) or **Nice** (safe to defer).
3. Decide where it goes:
   - If a safe, conventional default exists (a wrong guess only makes a test provisional, not dangerous), write it as an Open Question with `Default assumption (pending PO): …` and add a matching `[Provisional]` checklist line.
   - If there's no safe default, it's an Open Question only. Never invent the expected result.

Ambiguity gaps overlap the Testability defects. Cross-reference them instead of repeating them.
