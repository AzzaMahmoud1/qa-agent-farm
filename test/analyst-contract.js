/** Prompt MAIN GATE contract unit tests. */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { checkAnalystPromptContract } from "../agents/analyst-contract.js";
import { setFarmCtx } from "../agents/ctx-bridge.js";
import { validateAnalystOutputLive } from "../agents/validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const prerequisites = require(path.join(__dirname, "../lib/prerequisites.cjs"));

setFarmCtx({
  prerequisites,
  storyRequiresApi: () => false,
  storyRequiresWebpage: () => false,
  isRequiredInputReady: () => false,
  isHumanInputSatisfied: () => true,
  humanApiInput: { ok: false },
  humanWebpageInput: { ok: false },
  getLiveHumanInputNeed: () => ({ needsHumanInput: false, types: [] }),
  getProvidedPrerequisites: () => [],
  EVENTS: [],
  currentStory: null,
  storyOutputs: {},
  executionResult: null,
});

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

// A2: low confidence + PROCEED (+ blocking ASK) ⇒ fail — low cannot PROCEED at all
assert.equal(checkAnalystPromptContract({
  ...base,
  analyst_report: {
    orchestrator_actions: [
      { action: "PROCEED", blocking: false },
      { action: "ASK_HUMAN", blocking: true, detail: "Provide staging URL + admin credentials for the login flow" },
    ],
    confidence: { overall: "low" },
  },
}).ok, false);

// A3: PROCEED with ready_for_test_design false ⇒ fail
assert.equal(checkAnalystPromptContract({
  ...base,
  ready_for_test_design: false,
  analyst_report: {
    orchestrator_actions: [{ action: "PROCEED", target: "writer", blocking: false }],
    confidence: { overall: "high" },
  },
}).ok, false);

// A1: access missing + PROCEED + non-blocking ASK_HUMAN ⇒ ok
assert.equal(checkAnalystPromptContract({
  ...base,
  prerequisites_needed: {
    blocking: [{ item: "Staging URL", category: "access", satisfied_by_ticket: false }],
    non_blocking: [],
  },
  analyst_report: {
    orchestrator_actions: [
      { action: "PROCEED", target: "writer", blocking: false },
      {
        action: "ASK_HUMAN",
        target: "human",
        detail: "Provide staging URL for the login environment",
        blocking: false,
        requires_value: true,
      },
    ],
    confidence: { overall: "high" },
  },
}).ok, true);

// B1: explicit blocks:execution overrides data category → PROCEED ok
assert.equal(checkAnalystPromptContract({
  ...base,
  prerequisites_needed: {
    blocking: [{ item: "Sample payload", category: "data", blocks: "execution", satisfied_by_ticket: false }],
    non_blocking: [],
  },
}).ok, true);

// B1: explicit blocks:design overrides access category → PROCEED fails
assert.equal(checkAnalystPromptContract({
  ...base,
  prerequisites_needed: {
    blocking: [{ item: "Confirm access model", category: "access", blocks: "design", satisfied_by_ticket: false }],
    non_blocking: [],
  },
}).ok, false);

// Dual-grader regression: lib/prerequisites + analyst-contract must both honor blocks:execution
{
  const dualPayload = {
    success: true,
    analysis_complete: true,
    ready_for_test_design: true,
    analyst_reasoning: {
      ticket_read: "Sample login ticket",
      ambiguous_acs: [],
      unimplemented_rules: [],
      rejected_as_non_ac: [],
    },
    testable_conditions: [{
      id: "AC-1",
      ac_text: "User can log in with valid credentials",
      source: "Business Rules",
      section: "business_rules",
      testable_statement: "System MUST authenticate user when valid credentials are submitted",
    }],
    prerequisites_needed: {
      blocking: [{
        item: "Sample payload",
        category: "data",
        blocks: "execution",
        satisfied_by_ticket: false,
      }],
      non_blocking: [],
    },
    coverage_gaps: [],
    analyst_report: {
      what_i_did: ["scanned"],
      why: [],
      orchestrator_actions: [{ action: "PROCEED", target: "writer", blocking: false }],
      confidence: { overall: "high", reason: "ok" },
    },
    summary: "1 condition",
  };

  const contract = checkAnalystPromptContract(dualPayload);
  assert.equal(contract.ok, true, contract.failures.join("; "));

  const libGate = prerequisites.validateAnalystOutput({}, dualPayload);
  assert.equal(libGate.passed, true, (libGate.failures || []).join("; "));

  const live = validateAnalystOutputLive({}, dualPayload);
  assert.equal(live.passed, true, (live.failures || live.detail_failures || []).join("; "));
}

console.log("analyst-contract tests: ok");
