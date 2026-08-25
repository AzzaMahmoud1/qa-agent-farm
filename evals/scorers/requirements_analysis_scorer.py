"""Structural/gate scorer for the requirements_analysis skill.

Not an LLM-judge — same spirit as this repo's existing regression tests
(`test/eval-fixes.js`, `test/analyst-contract.js`): each dataset row holds a
pre-built analyst output plus an expected gate verdict, and this script
checks `analyst_agent.validation.check_requirements_analysis_gate` produces
that verdict. Useful both as a regression check on the gate logic itself and
as a harness to score real LLM output later (feed a live `AnalystResult`'s
`.parsed` through the same scorer).

Usage:
    python -m evals.scorers.requirements_analysis_scorer
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from analyst_agent.models import RequirementsAnalysisResult  # noqa: E402
from analyst_agent.validation import check_requirements_analysis_gate  # noqa: E402

DATASET_PATH = Path(__file__).resolve().parent.parent / "datasets" / "requirements_analysis.jsonl"


def score() -> int:
    rows = [json.loads(line) for line in DATASET_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    passed = 0
    failed = 0

    for row in rows:
        result = RequirementsAnalysisResult.model_validate(row["analyst_output"])
        gate = check_requirements_analysis_gate(result)
        expected_ok = row["expected"]["gate_ok"]

        if gate.ok == expected_ok:
            passed += 1
            print(f"PASS  {row['id']}: gate.ok={gate.ok} (expected {expected_ok})")
        else:
            failed += 1
            print(f"FAIL  {row['id']}: gate.ok={gate.ok} (expected {expected_ok})")
            for f in gate.failures:
                print(f"        - {f}")

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(score())
