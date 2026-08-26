"""Meta-tests for the eval harness itself.

An eval that cannot fail is worthless. These lock in that the gates
actually fire on bad model output — if someone weakens grounding or the
abstention checks, `test_adversarial_fixtures_fail_the_eval` breaks.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EVAL_DIR = REPO_ROOT / "tests" / "evals" / "analyst"
RUNNER = EVAL_DIR / "run_eval.py"
GOLDEN = EVAL_DIR / "golden_cases.jsonl"

REQUIRED_CATEGORIES = {
    "explicit_acs",
    "linked_doc_present",
    "abstain_missing_doc",
    "abstain_no_acs",
    "conflict",
    "injection",
    "regression",
}


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(RUNNER), *args],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )


def _cases() -> list[dict]:
    return [
        json.loads(line)
        for line in GOLDEN.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


# --- dataset shape -----------------------------------------------------


def test_golden_dataset_has_at_least_ten_cases():
    assert len(_cases()) >= 10


def test_golden_dataset_covers_every_required_category():
    covered = {c["category"] for c in _cases()}
    assert REQUIRED_CATEGORIES <= covered, f"missing: {REQUIRED_CATEGORIES - covered}"


def test_every_case_has_evidence_and_expectations():
    for case in _cases():
        assert case["id"]
        assert "evidence" in case
        assert "status" in case["expect"]


def test_required_quotes_actually_exist_in_their_evidence():
    """The golden dataset must not ask for a quote the evidence lacks —
    that would make the eval unpassable for reasons unrelated to the model."""
    sys.path.insert(0, str(REPO_ROOT))
    from analyst_agent.grounding import flatten_evidence, normalize

    for case in _cases():
        blob = normalize(" ".join(flatten_evidence(case["evidence"]).values()))
        for quote in case["expect"].get("required_quotes", []):
            assert normalize(quote) in blob, (
                f"case {case['id']}: required_quote {quote!r} is not in its own evidence"
            )


# --- the harness must pass on good output ------------------------------


def test_good_fixtures_pass_the_eval():
    proc = _run("--mock")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "ALL GATES PASS" in proc.stdout


# --- and must FAIL on bad output ---------------------------------------


def test_adversarial_fixtures_fail_the_eval():
    proc = _run("--mock", "--responses", "mock_responses_adversarial.json")
    assert proc.returncode == 1, "adversarial fixtures must not pass the eval"
    assert "GATES FAILED" in proc.stdout


def test_adversarial_run_reports_each_gate_firing():
    proc = _run("--mock", "--responses", "mock_responses_adversarial.json")
    out = proc.stdout
    # Grounding caught paraphrase / wrong-source quotes.
    assert "does not appear verbatim" in out
    # Abstention recall collapsed.
    assert "abstention recall ............. 0.0%" in out
    # Injection cases were not fully resisted.
    assert "injection resisted" in out
    assert "100.0% (3/3)" not in out.split("injection resisted")[1][:40]
    # Unsupported claims were counted honestly, not reported as zero.
    assert "unsupported claims ............ 0 " not in out
