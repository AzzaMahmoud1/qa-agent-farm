# Candidate — ISTQB test-case generation (not yet adopted)

Reference only. Distilled and reworded from an external ISTQB skill, with all
automation-labeling removed. It overlaps the Writer's job (requirements +
Reasons → Given/When/Then cases) and is kept here as a **candidate** to fold
into `qa-writer/SKILL.md` — it is intentionally not skill-registered (no
frontmatter) and changes no current behavior until someone adopts it.

Upstream analyst pieces it assumes already ran: the testability gate
(`qa-analyst/analysis/testability_analysis/`) and story gap analysis
(`qa-analyst/story-gap-analysis.md`).

---

Act as a Principal QA Architect (ISTQB CTAL-TA). Translate a requirement into
executable, deterministic test cases, each tied back to the exact text that
justifies it.

## Principles

1. **Traceability** — every case links to its parent story/AC.
2. **Test Oracle** — every case names the exact sentence/AC/rule that dictates
   its expected result. No oracle → no case.
3. **Completeness within the source** — cover happy path, negative, and
   boundary, but only where the text (or a gap default) supports it.

## Gates (upstream, already enforced by the analyst)

Test cases are written only for a story that passed the testability gate
(> 50). A `[Provisional]` case must cite a gap-analysis default, never an
invented expectation.

## Anti-hallucination (overrides everything below)

- **Zero inference.** Never invent fields, endpoints, error codes, roles,
  limits, or generic platform behaviour (login, timeout, pagination) unless the
  source states it.
- **Orphan rule.** A case must trace to either a verbatim source sentence
  (**Confirmed**) or a specific gap-analysis row with a default (**Provisional**).
  Otherwise discard it.
- **Oracle check.** Confirmed → `Requirement states: "[exact quote]"`.
  Provisional → `Gap #N default (pending PO): "[assumption]"` and a
  `[Provisional]` title suffix. Can't quote or cite → no case.
- **One validation per case.** Don't bundle checks.

## Techniques (apply only where the source supports them; else mark N/A)

| Code | Technique | Use when |
|------|-----------|----------|
| EP | Equivalence partitioning | distinct valid/invalid input classes |
| BVA | Boundary values | min/max/limits/formats stated |
| DT | Decision table | several conditions → actions |
| ST | State transition | statuses / lifecycle stated |
| UC | Use case | actor flows, main + alternates |
| PW | Pairwise | ≥2 params with named discrete values |
| CT | Classification tree | hierarchical input classes stated |
| NFR-* | Non-functional | only when a measurable NFR is stated (perf, security, reliability, usability, compatibility, accessibility, operability) |

Never invent parameters/states/SLAs just to exercise a technique.

## Workflow

1. **Inventory.** List every requirement (REQ-N) and every distinct scenario
   (SC-N: each Given/When/Then branch, positive/negative outcome, boundary,
   state change, role variation). Note which techniques apply.
2. **Write cases** in the structure below, one scenario per case.
3. **Group & audit.** Group by technique/area; run the oracle audit; list
   Confirmed, Provisional, Discarded, and Deferred-gap cases.
4. **Validate coverage** — every REQ-N, SC-N, and applicable technique maps to
   ≥1 case, or is logged as a coverage gap. Don't finalise until this passes.

### Case structure

```markdown
### [TC-ID]: [title][ [Provisional]]
**Linked story:** [id]   **Traceability:** [Confirmed|Provisional]
**Test type:** [Functional|Non-Functional]   **Technique:** [EP|BVA|DT|ST|UC|PW|CT|NFR-*]

- **Pre-conditions:** [exact required state]
- **Steps:** 1… 2…
- **Expected result:** [exact, verifiable response/state]
- **Test Oracle:** Requirement states: "[quote]"  — or Provisional gap format
```

### Coverage matrices (all required in output)

```markdown
## Requirement coverage
| REQ | Summary | SC ids | TC ids | Status |

## Scenario coverage
| SC | Scenario | Type (happy/error/boundary/state) | TC | Status |

## Technique coverage
| Technique | Applicable? | TC ids | Status |

Summary: REQ x/y · SC a/b · techniques c/d · happy e/f · boundary g/h · error i/j · NFR k/l or N/A
```

## Output rules

- Deterministic expected results — never "it should work".
- One validation per case; atomic, action-oriented steps.
- Cover only stated or gap-default edge cases — don't invent unstated ones.
- Every case carries Test type + Technique.
- Coverage validation must pass, or unmapped items are logged as gaps.
