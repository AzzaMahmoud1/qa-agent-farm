/** Prompt MAIN GATE contract unit tests. */
import assert from "node:assert/strict";
import { checkAnalystPromptContract } from "../agents/analyst-contract.js";

const base = {
  testable_conditions: [{ id: "AC-1" }],
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

assert.equal(checkAnalystPromptContract({
  ...base,
  prerequisites_needed: {
    blocking: [{ item: "URL", satisfied_by_ticket: false }],
    non_blocking: [],
  },
}).ok, false);

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
    orchestrator_actions: [{ action: "ASK_HUMAN", blocking: true, detail: "need URL" }],
    confidence: { overall: "medium" },
  },
  prerequisites_needed: {
    blocking: [{ item: "URL", satisfied_by_ticket: false }],
    non_blocking: [],
  },
}).ok, true);

console.log("analyst-contract tests: ok");
