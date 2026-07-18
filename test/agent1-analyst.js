/**
 * Unit tests for Agent 1 extractFinalJson + validateAnalystOutput + thin orchestrator gate.
 * Run: node test/agent1-analyst.js
 */
import assert from "node:assert/strict";
import { extractFinalJson } from "../src/agents/utils/extractFinalJson.js";
import { validateAnalystOutput } from "../src/agents/requirementAnalyst.js";
import { checkAnalystPromptContract } from "../agents/analyst-contract.js";
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
      confidence: { overall: "high", reason: "ok" },
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

// --- validateAnalystOutput + MAIN GATE ---
{
  assert.equal(validateAnalystOutput(validParsed()), true);
  assert.throws(() => validateAnalystOutput({ success: true }), /missing required keys/);
  assert.throws(
    () => validateAnalystOutput(validParsed({ prerequisites_needed: {} })),
    /blocking must be an array/,
  );
  assert.throws(
    () => validateAnalystOutput(validParsed({
      testable_conditions: [],
      ready_for_test_design: true,
    })),
    /MAIN GATE|PROCEED forbidden|ready_for_test_design/i,
  );
}

{
  const bad = checkAnalystPromptContract(validParsed({
    ready_for_test_design: true,
    analyst_report: {
      what_i_did: [],
      why: [],
      orchestrator_actions: [],
    },
  }));
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.some((f) => /non-empty|PROCEED/i.test(f)));
}

// --- thin orchestrator gate (executes Analyst actions only) ---
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
  assert.equal(hold.blocking_actions[0].action, "ASK_HUMAN");
}

{
  const go = resolveAnalystOrchestratorGate(validParsed());
  assert.equal(go.state, PIPELINE_STATE.READY_FOR_WRITER);
  assert.equal(go.proceed, true);
  assert.ok(go.writer_input.testable_conditions.length);
}

{
  // Empty actions → contract incomplete (NEEDS_INPUT), not invented clarification.
  const unclear = resolveAnalystOrchestratorGate(validParsed({
    ready_for_test_design: false,
    analyst_report: { what_i_did: [], why: [], orchestrator_actions: [] },
  }));
  assert.equal(unclear.state, PIPELINE_STATE.NEEDS_INPUT);
  assert.equal(unclear.proceed, false);
  assert.match(unclear.message || "", /MAIN GATE|incomplete/i);
}

{
  // HOLD is passed through — not rewritten to ASK_HUMAN.
  const holdPass = resolveAnalystOrchestratorGate(validParsed({
    ready_for_test_design: false,
    analyst_report: {
      what_i_did: [],
      why: [],
      orchestrator_actions: [
        { action: "HOLD", target: "human", detail: "waiting on product decision", blocking: true },
      ],
    },
  }));
  assert.equal(holdPass.state, PIPELINE_STATE.WAITING_ON_HUMAN);
  assert.equal(holdPass.blocking_actions[0].action, "HOLD");
}

{
  // Live path: do not invent actions when omitted.
  const live = ensureAnalystReportActions({
    success: true,
    runner: "cursor_agent_cli",
    ready_for_test_design: false,
    testable_conditions: [{ id: "AC-1" }],
    prerequisites_needed: { blocking: [], non_blocking: [] },
    analyst_report: { what_i_did: [], why: [] },
  });
  assert.equal(live.prompt_contract_broken, true);
  assert.deepEqual(live.analyst_report.orchestrator_actions, []);
}

{
  // Stub path may still derive ASK for missing prereqs.
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

{
  const emptyAc = resolveAnalystOrchestratorGate(validParsed({
    testable_conditions: [],
    ready_for_test_design: true,
  }));
  assert.equal(emptyAc.state, PIPELINE_STATE.NEEDS_INPUT);
  assert.equal(emptyAc.proceed, false);
}

console.log("agent1-analyst tests: ok");
