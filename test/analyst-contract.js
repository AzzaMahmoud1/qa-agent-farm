/** Prompt MAIN GATE contract unit tests. */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { checkAnalystPromptContract } from "../agents/analyst-contract.js";
import { setFarmCtx } from "../agents/ctx-bridge.js";
import { validateAnalystOutputLive, checkAnalystRisk } from "../agents/validator.js";

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
  testable_conditions: [{ id: "AC-1", ac_text: "User can log in with valid credentials", source: "Business Rules" }],
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

// Grounding: PROCEED on a condition with no verbatim ticket quote ⇒ fail
{
  const ungrounded = checkAnalystPromptContract({
    ...base,
    testable_conditions: [{ id: "AC-1" }],
  });
  assert.equal(ungrounded.ok, false);
  assert.ok(ungrounded.failures.some((f) => /grounding/i.test(f)), ungrounded.failures.join("; "));
}

// Grounding: a too-short quote (< 12 chars normalized) is not grounding ⇒ fail
assert.equal(checkAnalystPromptContract({
  ...base,
  testable_conditions: [{ id: "AC-1", ac_text: "logs in" }],
}).ok, false);

// Visual: PROCEED resting on an image-derived condition needs a confirming ASK_HUMAN
assert.equal(checkAnalystPromptContract({
  ...base,
  testable_conditions: [{ id: "AC-1", ac_text: "Login button is centered below the form", source: "attachment:mockup.png", visual: true }],
}).ok, false);
// …and passes when a confirming ASK_HUMAN accompanies the PROCEED
assert.equal(checkAnalystPromptContract({
  ...base,
  testable_conditions: [{ id: "AC-1", ac_text: "Login button is centered below the form", source: "attachment:mockup.png", visual: true }],
  analyst_report: {
    orchestrator_actions: [
      { action: "PROCEED", target: "writer", blocking: false },
      { action: "ASK_HUMAN", target: "human", detail: "Confirm the login layout read from mockup.png is correct", blocking: false, requires_value: true },
    ],
    confidence: { overall: "high" },
  },
}).ok, true);

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
      risk: "P1",
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

  // Risk (soft output-quality check): dropping risk fails the live validator but
  // NOT the MAIN GATE readiness contract — risk never changes readiness.
  const noRisk = {
    ...dualPayload,
    testable_conditions: dualPayload.testable_conditions.map(({ risk, ...c }) => c),
  };
  const contractNoRisk = checkAnalystPromptContract(noRisk);
  assert.equal(contractNoRisk.ok, true, "MAIN GATE must ignore missing risk");
  const liveNoRisk = validateAnalystOutputLive({}, noRisk);
  assert.equal(liveNoRisk.passed, false, "live validator must fail on missing risk");
  assert.ok(
    (liveNoRisk.failures || []).some((f) => /RISK:.*missing a risk/i.test(f)),
    (liveNoRisk.failures || []).join("; "),
  );
}

// checkAnalystRisk unit checks
{
  const ok = [{ id: "AC-1", risk: "P0" }, { id: "AC-2", risk: "p3" }];
  assert.deepEqual(checkAnalystRisk({ testable_conditions: ok }), []);
  // no conditions ⇒ nothing to check
  assert.deepEqual(checkAnalystRisk({ testable_conditions: [] }), []);
  assert.deepEqual(checkAnalystRisk({}), []);
  // missing risk
  const missing = checkAnalystRisk({ testable_conditions: [{ id: "AC-1" }] });
  assert.ok(missing.some((f) => /missing a risk/i.test(f)), missing.join("; "));
  // out-of-enum
  const bad = checkAnalystRisk({ testable_conditions: [{ id: "AC-1", risk: "P9" }] });
  assert.ok(bad.some((f) => /out-of-enum/i.test(f)), bad.join("; "));
}

console.log("analyst-contract tests: ok");
