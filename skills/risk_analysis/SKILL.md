---
name: risk_analysis
description: >-
  PLACEHOLDER — scope not yet defined. Intended to assess risk (impact,
  likelihood, blast radius) of a change as input to QA prioritization. No
  implementation in this repo yet.
---

# Risk analysis — placeholder

**Scope is not yet defined in this repo.** No agent in the QA Agent Farm
currently produces a distinct risk assessment — nothing named "risk
analysis" (or equivalent) exists anywhere under `.cursor/`, `agents/`, or
`src/`.

This folder exists so the layout matches the intended 5-skill shape
(`analyst_agent/models.py` has a matching `RiskAnalysisResult` placeholder
model — `summary` + `findings` only). Do not build real analysis logic
against this stub without first defining:

- Risk of *what*, relative to *what* (a shipped regression? a security gap?
  a business-impact ranking of coverage gaps?)
- Whether it consumes `requirements_analysis`'s `coverage_gaps` (which
  already has a `category: security` bucket) or is a separate signal
- How a risk verdict should influence pipeline gating, if at all

Until that's specified, `analyst_agent/validation.py`'s
`check_risk_analysis_gate` is a no-op pass-through.
