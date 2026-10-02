---
name: root_cause_analysis
description: >-
  Failure investigation (review phase). A 5-Whys chain where each step is
  labelled evidenced or hypothesis, with the root cause categorised Ishikawa-style.
---

# Root cause analysis

Find out **why** a failure happened, not just where it showed up. This pass carries the highest risk of hallucination, because a confident but wrong cause sends engineers to fix code that was never broken. Shared rules: `../../../qa-analyst/analysis/COMMON.md`.

**The why-chain.** Each step is a question, an answer and a `support` label:
- `evidenced` steps carry an `evidence_quote` and `source_field` taken from a log, trace, diff or test output.
- `hypothesis` steps are an inference and carry **no** quote.

Never label a hypothesis as evidenced. Stop once you reach a cause someone can act on; three solid steps beat five padded ones.

**Code enforces two rules.** A root cause with no evidenced step is dropped. A chain with more hypothesis steps than evidenced ones gets its confidence capped below 0.75.

**Category:** `code`, `data`, `environment`, `process`, `observability`, `people` or `external_dependency`. Often `process` or `observability` is more honest than forcing a `code` cause.

If there are no logs, trace, diff or reproduction, return `insufficient_information` and name what you'd need. Leave out `corrective_action` rather than guessing one.

## Output

```json
{
  "status": "success | insufficient_information | conflicting_evidence",
  "root_causes": [{
    "symptom": "Checkout returns 500 for carts over 50 items.",
    "why_chain": [
      { "question": "Why 500?", "answer": "The serializer raises above 50 items.", "support": "evidenced",
        "evidence_quote": "TypeError: cannot serialize cart with 51 items", "source_field": "logs[0]" },
      { "question": "Why does it raise?", "answer": "A fixed buffer has no bound check.", "support": "hypothesis" }
    ],
    "root_cause": "The serializer assumes a max cart size that isn't enforced upstream.",
    "category": "code",
    "evidence_quote": "TypeError: cannot serialize cart with 51 items", "source_field": "logs[0]", "confidence": 0.6
  }],
  "missing_information": ["Serializer source not provided."], "overall_confidence": 0.6, "requires_human_review": true
}
```
