# Evals — regression

This `evals/` directory scores `analyst_agent`'s skill outputs against the
gate logic in `analyst_agent/validation.py` (see
`evals/scorers/requirements_analysis_scorer.py` and
`evals/datasets/requirements_analysis.jsonl`). It's structural/gate scoring,
not LLM-judge grading — same spirit as this repo's existing JS regression
tests (`test/eval-fixes.js`, `test/analyst-contract.js`).

**Not wired into `npm test`.** `analyst_agent/` is a standalone Python
component, separate from the JS pipeline — run its checks independently:

```bash
pip install -e .
pytest tests/ -v
python -m evals.scorers.requirements_analysis_scorer
```

Only `requirements_analysis` has fixtures right now — the other four skills
(source/risk/test_gap/root_cause analysis) have no defined contract yet, so
there's nothing to score (see each skill's `SKILL.md` under `skills/`).
