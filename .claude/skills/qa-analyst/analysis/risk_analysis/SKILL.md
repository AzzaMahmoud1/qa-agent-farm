---
name: risk_analysis
description: >-
  Risk-based testing. Name concrete, grounded failure modes and judge each one
  on likelihood and impact separately. Code computes the priority.
---

# Risk analysis

Name **what could fail**, so testing time goes where a failure would hurt most. This pass is only useful if it separates high risks from low ones. If you rate every risk high×high, code rejects the result.

Judge the two axes **separately**:

| | high | medium | low |
|---|---|---|---|
| **likelihood** | touched by the change, complex, concurrent or async, many edge cases | touched indirectly, moderately complex | stable, simple, untouched |
| **impact** | data loss, security or auth bypass, payment errors, blocks a core journey, regulatory breach | degraded experience, a workaround exists, a secondary flow | cosmetic, a rare path, trivial to recover |

A rare payment failure is low likelihood but high impact. Don't average the two. You don't set the priority. Code derives it from a 3×3 matrix and maps it to P0–P3.

Each risk anchors to a quote. A generic risk with no anchor in the story ("the API might be slow") is noise. The `rationale` says *why* you chose those two levels, based on the quote. Restating the risk doesn't count as a rationale.

If the prompt includes a **security failure modes** list, treat it as a set of prompts to consider, not as evidence. Include one only when a story quote supports it.

## Output

```json
{
  "status": "success | insufficient_information | conflicting_evidence",
  "risks": [{
    "risk": "A retried checkout double-charges the customer.",
    "likelihood": "medium", "impact": "high",
    "rationale": "Retry-on-timeout with no idempotency key can charge twice.",
    "suggested_test": "Force a timeout; assert a single charge.",
    "evidence_quote": "retry the payment request on timeout", "source_field": "description", "confidence": 0.8
  }],
  "missing_information": [], "overall_confidence": 0.8, "requires_human_review": false
}
```
