/** IO consistency + deliberative orchestrator decision tests. */
import assert from "node:assert/strict";
import { checkIoConsistency, HANDOFF } from "../agents/io-consistency.js";
import { deliberateHandoff, ORCH_ACTION } from "../agents/orchestrator-decide.js";
import { validateWriterOutputLive, markSimulatedGate } from "../agents/validator.js";

const analyst = {
  analysis_complete: true,
  ready_for_test_design: true,
  testable_conditions: [
    { id: "AC-1", ac_text: "User can reset password with a valid token", source: "Business Rules" },
    { id: "AC-2", ac_text: "Expired token shows error", source: "Exception Flow" },
  ],
  analyst_reasoning: { ambiguous_acs: [], unimplemented_rules: [], rejected_as_non_ac: [] },
  analyst_report: {
    orchestrator_actions: [{ action: "PROCEED", target: "writer", blocking: false }],
  },
};

{
  const goodWriter = {
    success: true,
    test_outlines: [
      { id: "TO-01", mapped_acs: ["AC-1"], status: "draft" },
      { id: "TO-02", mapped_acs: ["AC-2"], status: "draft" },
    ],
    test_cases: [
      { id: "TC-01", ac_ref: "AC-1" },
      { id: "TC-02", ac_ref: "AC-2" },
    ],
  };
  const io = checkIoConsistency(HANDOFF.ANALYST_WRITER, { analyst, writer: goodWriter });
  assert.equal(io.ok, true, io.failures.join("; "));
  const live = validateWriterOutputLive({}, goodWriter, analyst);
  assert.equal(live.passed, true);
  assert.equal(live.gate_mode, "LIVE");
  assert.equal(live.orchestrator_decision.action, ORCH_ACTION.PROCEED);
}

{
  // Orphan AC mapping → fidelity fail
  const bad = {
    success: true,
    test_outlines: [{ id: "TO-01", mapped_acs: ["AC-99"], status: "draft" }],
    test_cases: [],
  };
  const io = checkIoConsistency(HANDOFF.ANALYST_WRITER, { analyst, writer: bad });
  assert.equal(io.ok, false);
  assert.ok(io.failures.some((f) => /unknown AC/i.test(f)));
  const live = validateWriterOutputLive({}, bad, analyst);
  assert.equal(live.passed, false);
  assert.equal(live.gate_mode, "LIVE");
}

{
  // Stub data without per-TC linkage
  const io = checkIoConsistency(HANDOFF.WRITER_DATA, {
    writer: { test_outlines: [{ id: "TO-01" }], test_cases: [{ id: "TC-01" }] },
    data: { datasets: [{ id: "DS-1", rows: 2 }], rows_extracted: 2 },
  });
  assert.equal(io.ok, false);
  assert.ok(io.failures.some((f) => /per-test-case/i.test(f)));
}

{
  const decision = deliberateHandoff({
    handoff: HANDOFF.TICKET_ANALYST,
    ctx: { analyst },
    validation: { passed: true },
    analystActions: [{ action: "ASK_HUMAN", detail: "Provide staging URL", blocking: true }],
  });
  assert.equal(decision.action, ORCH_ACTION.ASK_HUMAN);
  assert.equal(decision.blocking, true);
}

{
  const sim = markSimulatedGate({ passed: true, target_agent: "reviewer" });
  assert.equal(sim.gate_mode, "SIMULATED_GATE");
  assert.equal(sim.simulated, true);
}

console.log("io-consistency tests: ok");
