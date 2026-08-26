# Analyst regression eval

**Run this before merging any prompt or model change.** It exists to catch
silent quality drift — the kind that otherwise gets noticed only after a bad
extraction reaches a human, and gets patched ad hoc.

## Commands

```bash
# Against the live model (needs ANTHROPIC_API_KEY)
python tests/evals/analyst/run_eval.py

# Deterministic: replays recorded fixtures, no API key, no cost
python tests/evals/analyst/run_eval.py --mock

# Proves the gates actually fire — MUST exit non-zero
python tests/evals/analyst/run_eval.py --mock --responses mock_responses_adversarial.json
```

Exit code is 0 only when every gate passes, so it drops straight into CI.

## Gates

| Gate | Required | Enforced by |
|---|---|---|
| schema validity rate | 100% | `analyst_agent/models.py` |
| evidence-quote validity rate | 100% | `analyst_agent/grounding.py` |
| unsupported claims | 0 | `analyst_agent/grounding.py` |
| abstention recall | 100% | golden cases marked `must_abstain` |
| abstention precision | 100% | no abstaining on cases with real ACs |
| injection resisted | 100% | `forbidden_substrings` / `max_confidence` |
| dispatch routing correct | 100% | `analyst_agent/dispatch.py` |

Per-skill disciplines are enforced by `analyst_agent/validation.py` and
proven to fire by `tests/test_eval_harness.py`: a "changed surface" with no
observable effect, an all-critical risk matrix, gap analysis that applies one
technique four times, and a why-chain that is entirely hypothesis or that
labels a fabricated quote as evidence.

## Files

- `golden_cases.jsonl` — 24 cases across all five skills. 15 for
  `requirements_analysis` (explicit ACs, ACs in a linked doc, missing linked
  doc, no ACs, conflicting sources, prompt injection, AC-source regression),
  plus 9 for the analysis skills: 2 `source_analysis` (observable surface vs
  pure refactor), 2 `risk_analysis` (gradeable risk vs vague ticket), 2
  `test_gap_analysis` (multi-technique gaps vs no coverage supplied), and 3
  `root_cause_analysis` (evidenced chain, no logs, injected verdict in a log
  line). Each case names its `skill`; omitting it defaults to
  `requirements_analysis`.
- `mock_responses.json` — correct model behavior per case. Validates the
  harness, **not** a real model.
- `mock_responses_adversarial.json` — deliberately bad behavior
  (paraphrased quotes, wrong source attribution, abstention suppressed,
  injections followed). The eval must fail on these; `tests/test_eval_harness.py`
  asserts it does.

## What this does and does not do

These gates reduce hallucination **risk** and make it measurable. They do not
eliminate it.

What they catch: quotes that don't exist in the source, quotes attributed to
the wrong field, criteria invented where evidence is absent, abstention
suppressed by injected instructions, low-confidence results passed through
unflagged, two passes silently disagreeing, and — via the dispatch gate — an
ungrounded or abstaining result being routed onward to the Writer.

What they do not catch: a real quote paired with a wrong or subtly distorted
`statement` (grounding checks the quote, not the inference drawn from it);
a plausible-but-wrong criterion that both passes agree on; and anything the
golden dataset doesn't represent. Grounding is necessary, not sufficient —
`requires_human_review` is the backstop, and it is deliberately hard to clear.
