/**
 * Unit tests for Agent 1 extractFinalJson + validateAnalystOutput + orchestrator gate.
 * Run: node test/agent1-analyst.js
 */
import assert from "node:assert/strict";
import { extractFinalJson } from "../src/agents/utils/extractFinalJson.js";
import { validateAnalystOutput } from "../src/agents/requirementAnalyst.js";
import {
  resolveAnalystOrchestratorGate,
  ensureAnalystReportActions,
  PIPELINE_STATE,
} from "../agents/orchestrator.js";

function validParsed(overrides = {}) {
  return {
    success: true,
    testable_conditions: [{ id: "AC-1" }],
    prerequisites_needed: { blocking: [], non_blocking: [] },
    coverage_gaps: [],
    analyst_report: {
      what_i_did: ["scanned"],
      why: [],
      orchestrator_actions: [
        { action: "PROCEED", target: "writer", detail: "go", blocking: false },
      ],
    },
    ready_for_test_design: true,
    summary: "1 condition",
    ...overrides,
  };
}

// --- extractFinalJson ---
{
  const full = `AMBIGUITY SCAN:\n- [CLEAN]\n\n\`\`\`json\n{"scratch":true}\n\`\`\`\n\nmore\n\n\`\`\`json\n${JSON.stringify(validParsed())}\n\`\`\``;
  const { scratchpad, parsed } = extractFinalJson(full);
  assert.ok(scratchpad.includes("AMBIGUITY SCAN"));
  assert.equal(parsed.success, true);
  assert.equal(parsed.summary, "1 condition");
}

{
  assert.throws(() => extractFinalJson("no json here"), /No ```json/);
}

{
  assert.throws(
    () => extractFinalJson("```json\n{bad}\n```"),
    /Failed to parse/,
  );
}

// --- validateAnalystOutput ---
{
  assert.equal(validateAnalystOutput(validParsed()), true);
  assert.throws(() => validateAnalystOutput({ success: true }), /missing required keys/);
  assert.throws(
    () => validateAnalystOutput(validParsed({ prerequisites_needed: {} })),
    /blocking must be an array/,
  );
}

// --- orchestrator gate ---
{
  const hold = resolveAnalystOrchestratorGate(validParsed({
    ready_for_test_design: false,
    analyst_report: {
      what_i_did: [],
      why: [],
      orchestrator_actions: [
        { action: "ASK_HUMAN", target: "human", detail: "need URL", blocking: true },
      ],
    },
  }));
  assert.equal(hold.state, PIPELINE_STATE.WAITING_ON_HUMAN);
  assert.equal(hold.proceed, false);
  assert.equal(hold.blocking_actions.length, 1);
}

{
  const go = resolveAnalystOrchestratorGate(validParsed());
  assert.equal(go.state, PIPELINE_STATE.READY_FOR_WRITER);
  assert.equal(go.proceed, true);
  assert.ok(go.writer_input.testable_conditions.length);
}

{
  const unclear = resolveAnalystOrchestratorGate(validParsed({
    ready_for_test_design: false,
    analyst_report: { what_i_did: [], why: [], orchestrator_actions: [] },
  }));
  // Uncleared ticket asks human for clarification (not a dead-end hard block).
  assert.equal(unclear.state, PIPELINE_STATE.WAITING_ON_HUMAN);
  assert.equal(unclear.proceed, false);
  assert.equal(unclear.blocking_actions[0].action, "ASK_HUMAN");
  assert.match(unclear.blocking_actions[0].detail, /clarif/i);
}

{
  // Legacy HOLD is rewritten to ASK_HUMAN clarification.
  const holdAsk = resolveAnalystOrchestratorGate(validParsed({
    ready_for_test_design: false,
    analyst_report: {
      what_i_did: [],
      why: [],
      orchestrator_actions: [
        { action: "HOLD", target: "human", detail: "Analyst did not clear the ticket", blocking: true },
      ],
    },
  }));
  assert.equal(holdAsk.state, PIPELINE_STATE.WAITING_ON_HUMAN);
  assert.equal(holdAsk.blocking_actions[0].action, "ASK_HUMAN");
  assert.equal(holdAsk.blocking_actions[0].requires_value, true);
}

{
  const derivedUncleared = ensureAnalystReportActions({
    success: true,
    ready_for_test_design: false,
    testable_conditions: [{ id: "AC-1", text: "x", source: "ac" }],
    prerequisites_needed: { blocking: [], non_blocking: [] },
  });
  assert.equal(derivedUncleared.analyst_report.orchestrator_actions[0].action, "ASK_HUMAN");
  assert.match(derivedUncleared.analyst_report.orchestrator_actions[0].detail, /clarif/i);
}

{
  const emptyAc = resolveAnalystOrchestratorGate(validParsed({
    testable_conditions: [],
    ready_for_test_design: true,
  }));
  assert.equal(emptyAc.state, PIPELINE_STATE.NEEDS_INPUT);
  assert.equal(emptyAc.proceed, false);
}

{
  const derived = ensureAnalystReportActions({
    success: true,
    ready_for_test_design: false,
    prerequisites_needed: {
      blocking: [{ item: "Staging URL", category: "access", satisfied_by_ticket: false }],
      non_blocking: [],
    },
  });
  assert.equal(derived.analyst_report.orchestrator_actions[0].action, "ASK_HUMAN");
  assert.equal(derived.analyst_report.orchestrator_actions[0].blocking, true);
}

console.log("agent1-analyst tests: ok");
