/** Prompt MAIN GATE contract unit tests. */
import assert from "node:assert/strict";
import { checkAnalystPromptContract } from "../agents/analyst-contract.js";

const base = {
  testable_conditions: [{ id: "AC-1" }],
  analysis_complete: true,
  ready_for_test_design: true,
  prerequisites_needed: { blocking: [], non_blocking: [] },
  analyst_report: {
    orchestrator_actions: [{ action: "PROCEED", target: "writer", blocking: false }],
    confidence: { overall: "high" },
  },
};

assert.equal(checkAnalystPromptContract(base).ok, true);

assert.equal(checkAnalystPromptContract({
  ...base,
  testable_conditions: [],
}).ok, false);

// Design-blocking (no category / data) + PROCEED → fail
assert.equal(checkAnalystPromptContract({
  ...base,
  prerequisites_needed: {
    blocking: [{ item: "Product decision on role X", category: "knowledge", satisfied_by_ticket: false }],
    non_blocking: [],
  },
}).ok, false);

// Access-only missing does not block PROCEED / ready_for_test_design
assert.equal(checkAnalystPromptContract({
  ...base,
  prerequisites_needed: {
    blocking: [{ item: "Staging URL", category: "access", satisfied_by_ticket: false }],
    non_blocking: [],
  },
}).ok, true);

assert.equal(checkAnalystPromptContract({
  ...base,
  analyst_report: {
    orchestrator_actions: [
      { action: "PROCEED", blocking: false },
      { action: "ASK_HUMAN", blocking: true, detail: "x" },
    ],
  },
}).ok, false);

assert.equal(checkAnalystPromptContract({
  ...base,
  ready_for_test_design: false,
  analyst_report: {
    orchestrator_actions: [{
      action: "ASK_HUMAN",
      blocking: true,
      detail: "Provide staging URL + admin credentials for the login flow",
    }],
    confidence: { overall: "medium" },
  },
  prerequisites_needed: {
    blocking: [{ item: "URL", category: "access", satisfied_by_ticket: false }],
    non_blocking: [],
  },
}).ok, true);

assert.equal(checkAnalystPromptContract({
  ...base,
  ready_for_test_design: false,
  analyst_report: {
    orchestrator_actions: [{ action: "ASK_HUMAN", blocking: true, detail: "need more info" }],
    confidence: { overall: "medium" },
  },
  prerequisites_needed: {
    blocking: [{ item: "unclear", satisfied_by_ticket: false }],
    non_blocking: [],
  },
}).ok, false);

assert.equal(checkAnalystPromptContract({
  ...base,
  analysis_complete: false,
}).ok, false);

console.log("analyst-contract tests: ok");
