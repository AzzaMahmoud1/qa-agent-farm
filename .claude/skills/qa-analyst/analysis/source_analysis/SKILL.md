---
name: source_analysis
description: >-
  Change impact. Turn a diff into the externally observable surfaces it
  affects, plus the regressions it could cause. Runs only when a diff is present.
---

# Source analysis (change impact)

Answer one question: **what can a tester now exercise differently, and what might this change break?** This isn't a code review.

**Surfaces count** when they can be exercised from outside: an endpoint (method, status, payload), a screen, field or message, a CLI flag, env var or config key, a stored field or migration, or a job, event or integration call. **These don't count:** renames, extracted helpers, import order, formatting, edits that only touch tests. `observable_effect` must describe something a tester would actually see. "None" isn't allowed.

Name `regression_areas` only when the diff supports them: a shared function whose callers changed, a modified query, a removed branch, a changed default. A `removed` surface must name at least one regression area. A diff that's purely internal returns zero surfaces (`insufficient_information`).

## Output

```json
{
  "status": "success | insufficient_information | conflicting_evidence",
  "changed_surfaces": [{
    "surface": "POST /api/sessions returns 429 over the rate limit",
    "change_type": "added | modified | removed | behavioral | config | dependency",
    "observable_effect": "Clients get 429 instead of 200 after 100 req/min.",
    "regression_areas": ["clients that retry on non-200 without backoff"],
    "evidence_quote": "+    return res.status(429).json({ error: 'rate_limited' })", "source_field": "diff[0].hunk", "confidence": 0.9
  }],
  "missing_information": [], "overall_confidence": 0.87, "requires_human_review": false
}
```
