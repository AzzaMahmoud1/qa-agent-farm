---
name: test_gap_analysis
description: >-
  Apply black-box test design techniques to each requirement element and name
  the test conditions the checklist must cover. When existing coverage is
  supplied, report only what it misses.
---

# Test gap analysis

For each element the story names (a field, a state, a rule, a flow), say which technique it needs and what condition that technique produces. Tests haven't been written yet at analyst time, so a "gap" here means a condition the checklist must contain. If the prompt includes **existing coverage** (test cases), report only the conditions those tests don't cover.

| technique | asks |
|---|---|
| `equivalence_partition` | Is each valid, invalid and special input class exercised? |
| `boundary_value` | min, min−1, max, max+1, zero, empty, one |
| `negative` | invalid input, wrong type, a missing required field, unauthorised access |
| `state_transition` | illegal or skipped transitions, not just the happy path |
| `decision_table` | each combination of conditions, including ones that shouldn't fire |
| `error_handling` | timeout, a 5xx from a dependency, partial failure, retry, rollback |
| `integration` | the contract: shape, status codes, auth, versioning |
| `accessibility` | keyboard path, screen-reader labels, focus order |
| `localization` | every documented language pair, RTL layout, formatting |

Name the specific element in `uncovered_element` (a named field or rule, not a feature area). If you apply only one lens, code rejects the result: four or more gaps that all use one technique need a note in `missing_information` explaining why the other techniques don't apply.

Severity is `high` (data loss, auth, or a core journey), `medium` (a secondary flow) or `low` (cosmetic or a rare path).

## Output

```json
{
  "status": "success | insufficient_information | conflicting_evidence",
  "gaps": [{
    "uncovered_element": "quantity field", "technique": "boundary_value",
    "gap": "The 1-99 range needs 0, 1, 99, 100.", "severity": "medium",
    "suggested_test": "Submit 0, 1, 99, 100; assert accept/reject per range.",
    "evidence_quote": "quantity must be between 1 and 99", "source_field": "description", "confidence": 0.88
  }],
  "missing_information": [], "overall_confidence": 0.85, "requires_human_review": false
}
```
