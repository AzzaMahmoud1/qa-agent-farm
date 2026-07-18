/**
 * Default pipeline must not script Analyst incomplete → Validator fail → retry.
 * That path belongs only to demo: "requirements".
 * Run: node test/real-run-no-forced-retry.js
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const prerequisites = require(path.join(root, "lib/prerequisites.cjs"));

const { setFarmCtx } = await import(pathToFileURL(path.join(root, "agents/ctx-bridge.js")).href);

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

const { buildEvents, resolvePipelineEvents } = await import(
  pathToFileURL(path.join(root, "agents/orchestrator.js")).href
);

const story = {
  id: "REQ-REAL",
  title: "Admin can view organization subscriptions",
  description: "As a System Admin I want to view all subscriptions for an organization.",
  acceptance_criteria_list: [
    "System Admin can open Organization details and see the Subscriptions list",
    "List shows active and inactive subscriptions",
  ],
  acceptance_criteria_entries: [
    { id: "AC-1", text: "System Admin can open Organization details and see the Subscriptions list" },
    { id: "AC-2", text: "List shows active and inactive subscriptions" },
  ],
  acceptance_criteria: 2,
  test_cases: ["TC-01", "TC-02"],
  components: ["Billing", "UI"],
  priority: "High",
  issueType: "Story",
  status: "Ready",
  coverage: 80,
  score: "8/10",
  blocking_gaps: 0,
};

const events = buildEvents(story);
const analystReturns = events.filter((e) => e.kind === "agent_return" && e.role === "analyst");
const analystValidatorAssigns = events.filter(
  (e) => e.kind === "validator_assign" && e.target_agent === "analyst",
);
const analystReinstructs = events.filter(
  (e) => e.kind === "orchestrator_reinstruct" && e.target_agent === "analyst",
);
const firstAnalystReturn = analystReturns[0];

assert.ok(firstAnalystReturn, "expected at least one analyst return");
assert.notEqual(
  firstAnalystReturn.agent_returns?.prerequisites_needed,
  null,
  "default run must return full analyst payload on first return (not incomplete stub)",
);
assert.ok(
  Array.isArray(firstAnalystReturn.agent_returns?.testable_conditions)
    || typeof firstAnalystReturn.agent_returns?.testable_conditions === "object",
  "first analyst return should include structured testable_conditions",
);

// When live quality passes: single validator check, no forced reinstruct.
if (analystValidatorAssigns.length === 1) {
  assert.equal(analystReinstructs.length, 0, "no forced Analyst reinstruct when quality passes");
  assert.equal(analystReturns.filter((e) => !e.is_retry).length, 1);
} else {
  // Live quality failed — retry is allowed, but must not use the old incomplete stub.
  assert.ok(analystValidatorAssigns.length <= 2);
  assert.ok(
    !/incomplete for L2 guidelines/i.test(String(firstAnalystReturn.message || "")),
    "must not use the old incomplete-stub message",
  );
}

const demoEvents = resolvePipelineEvents(story, { demo: "requirements" });
assert.ok(
  demoEvents.some((e) => e.kind === "orchestrator_reinstruct" && e.target_agent === "analyst"),
  "requirements demo still scripts Analyst validator retry",
);
assert.ok(
  demoEvents.some((e) => e.kind === "run_failed" || e.brake_applied || e.kind === "validator_brake"),
  "requirements demo still ends in abort/brake path",
);

console.log("real-run-no-forced-retry tests: ok");
