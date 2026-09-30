# Testability reference — ISTQB CTAL-TA §5.2

Source checklists behind `testability_analysis/SKILL.md`. The SKILL holds the
scored rubric and gate; this file holds the syllabus wording, the canonical
ambiguity list, and tailoring notes so the SKILL stays lean.

**Source:** ISTQB CTAL-TA Syllabus, Ch. 5 Reviews, §5.2 — TA-5.2.1
(requirements), TA-5.2.2 (user stories), TA-5.2.3 (tailoring).

## TA-5.2.2 — user story checklist

1. Written from the viewpoint of the person requesting it.
2. Feature clearly defined and distinct.
3. Acceptance criteria defined and testable.
4. Story prioritized.
5. Follows the common format — `As a [role], I want [goal], so that [benefit]`.

Maps to rubric rows **US-1 … US-5**.

## TA-5.2.1 — requirements checklist

1. Each requirement is testable.
2. Each has acceptance criteria.
3. Each has a defined priority.
4. Uniquely identified.
5. Specification is versioned.
6. Traceable to business/marketing requirements.
7. Traceable to use cases.

Maps to rubric rows **R-1 … R-5** (a Jira key usually satisfies R-1, its epic
link often R-4 — confirm from the evidence, don't assume).

## Testability dimensions

| Dimension | Question | Row |
|-----------|----------|-----|
| Clarity | Is it unambiguous? | T-1 |
| Measurability | Can results be objectively verified? | T-2 |
| Completeness | Are all relevant scenarios derivable? | T-3 |
| Consistency | Does it conflict with anything? | T-4 |
| Atomicity | Is it a single testable unit? | T-5 |

## Ambiguity trigger words (canonical list)

Flag when used without a measurable definition:

`appropriate`, `user-friendly`, `quickly`, `efficiently`, `intuitive`,
`minimal`, `reasonable`, `adequate`, `fast`, `easy`, `ready`, `seamless`,
`robust`.

Replace with an observable outcome: "responds within 2 seconds", "displays
MSG03", "completes in ≤ 3 steps". This is the same list the analyst's
**Ambiguity red-flag pass** (`qa-analyst/SKILL.md`) applies.

## Acceptance-criteria quality

- Precise, measurable, concise.
- Each criterion is true/false when tested.
- States **what** shall be achieved, not **how**.
- Covers non-functional characteristics where relevant.
- Formats: scenario (Given / When / Then) or rule (input → output bullets).

## Test Analyst review perspective

While reviewing, ask: Can I write test cases from this? Are the AC measurable?
Are boundaries/edge cases definable? What test data will I need? Can every
condition trace back to the story?

## Tailoring (TA-5.2.3)

- **Early refinement** — allow high-level conditions; flag gaps for
  conversation rather than blocking.
- **Sprint-ready** — require full AC, priority, and traceability.
- **Domain extensions** — add PCI-DSS, ZATCA, or project-specific checks only
  when the context or request calls for them.
