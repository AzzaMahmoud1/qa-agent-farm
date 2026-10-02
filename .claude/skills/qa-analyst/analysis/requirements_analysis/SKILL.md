---
name: requirements_analysis
description: >-
  Extract acceptance criteria, each traced to a verbatim quote. Conflicts are
  reported per criterion; abstain only when nothing usable is left.
---

# Requirements analysis

Extract the acceptance criteria the evidence actually establishes. Don't write tests and don't decide whether the story is ready.

Each criterion has these fields:
- `statement` is a testable claim about how the system behaves.
- `evidence_quote` and `source_field` follow the grounding rules.
- `confidence` is a number from 0 to 1.

If a criterion needs an assumption you'd have to supply yourself, it isn't grounded. Put that gap in `missing_information` instead.

**Which source wins.** A later comment from the PO or BA that refines or corrects the description wins, unless someone disputes it in a later comment. Use the comment as the evidence for that criterion.

**Conflicts.** When two sources disagree about the *same* behaviour and the precedence rule above doesn't settle it, leave that criterion out. Add it to `conflicts`, quoting both sides. Keep every criterion that isn't affected. Use `conflicting_evidence` only when the conflict leaves no usable criteria at all.

**Abstain** (`insufficient_information`) in these cases:
- The story relies on a document you weren't given.
- There are no acceptance criteria you can trace to a quote. Don't build criteria from the title or from what the feature "obviously" needs.

## Output

```json
{
  "status": "success | insufficient_information | conflicting_evidence",
  "acceptance_criteria": [
    { "statement": "The account locks after 5 failed logins.", "evidence_quote": "after 5 failed attempts the account must be locked", "source_field": "description", "confidence": 0.93 }
  ],
  "conflicts": [
    { "topic": "lockout duration", "quotes": [
      { "evidence_quote": "locked for 30 minutes", "source_field": "description" },
      { "evidence_quote": "lock it for 60 minutes", "source_field": "comments[1]" } ] }
  ],
  "missing_information": [],
  "overall_confidence": 0.88,
  "requires_human_review": false
}
```

Schema: `schemas/output.schema.json`.
