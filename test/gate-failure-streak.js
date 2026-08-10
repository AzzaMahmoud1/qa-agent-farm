/**
 * Cross-agent gate_failure_streak — Orbit thrashing brake.
 * Run: node test/gate-failure-streak.js
 */
import assert from "node:assert/strict";
import {
  validationGateEvents,
  escalateGateFailureStreakEvents,
} from "../agents/orchestrator.js";
import { PIPELINE_GATE_FAILURE_STREAK_MAX } from "../agents/registry.js";

assert.equal(PIPELINE_GATE_FAILURE_STREAK_MAX, 4);

const story = { id: "STREAK-1", title: "Streak brake", acceptance_criteria: 1 };

/**
 * Gap evidence: VALIDATOR_MAX_ATTEMPTS=2 is per-agent only.
 * Fail-then-pass on agent A, B, C (3 failures) then fail on D (4th) must escalate
 * instead of allowing D's per-agent retry — without aggregate streak this continues.
 */
{
  const streak = { count: 0 };
  const agents = ["writer", "test_data_extractor", "author", "test_executor"];

  // Three agents: fail attempt 1, pass attempt 2 → streak = 3, pipeline continues
  for (const agent of agents.slice(0, 3)) {
    const ev = validationGateEvents(agent, "phase", story, { success: true }, {
      failAttempts: [1],
      gateFailureStreak: streak,
      failures: [`${agent} soft fail`],
    });
    assert.ok(ev.some((e) => e.kind === "orchestrator_reinstruct"), `${agent} should retry`);
    assert.ok(ev.some((e) => e.kind === "orchestrator_gate"), `${agent} should pass on retry`);
    assert.ok(!ev.some((e) => e.kind === "gate_failure_streak_brake"));
  }
  assert.equal(streak.count, 3);

  // Fourth failure hits N=4 → escalate before retry
  const fourth = validationGateEvents("reviewer", "qa_review", story, { success: true }, {
    failAttempts: [1],
    gateFailureStreak: streak,
    failures: ["reviewer soft fail"],
  });
  assert.equal(streak.count, 4);
  assert.ok(fourth.some((e) => e.kind === "gate_failure_streak_brake"));
  assert.ok(fourth.some((e) => e.kind === "prerequisite_input_request"));
  assert.ok(!fourth.some((e) => e.kind === "orchestrator_reinstruct"), "must not retry after streak brake");
  assert.match(
    fourth.find((e) => e.kind === "gate_failure_streak_brake").decision,
    /gate failure streak/i,
  );
}

{
  const escalated = escalateGateFailureStreakEvents(
    "writer",
    "test_case_writing",
    story,
    { passed: false, failures: ["x"] },
    { count: 4 },
  );
  assert.equal(escalated[0].kind, "gate_failure_streak_brake");
  assert.equal(escalated[0].gate_failure_streak, 4);
}

console.log("gate-failure-streak tests: ok");
