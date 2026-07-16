/**
 * Regression: zero validated ACs must never unlock Writer/Author or emit run_end success.
 * Run: node test/zero-ac-gate.js
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

function wireFarm(story) {
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
    currentStory: story || null,
    storyOutputs: {},
    executionResult: null,
  });
}

wireFarm(null);

const {
  PIPELINE_STATE,
  hasTestableConditions,
  resolveAnalystOrchestratorGate,
  ensureAnalystReportActions,
  buildEvents,
} = await import(pathToFileURL(path.join(root, "agents/orchestrator.js")).href);

assert.equal(hasTestableConditions({ testable_conditions: [] }), false);
assert.equal(hasTestableConditions({ testable_conditions: [{ id: "AC-1" }] }), true);

{
  const gate = resolveAnalystOrchestratorGate({
    testable_conditions: [],
    ready_for_test_design: true,
    analyst_report: {
      orchestrator_actions: [{ action: "PROCEED", target: "writer", blocking: false }],
    },
  });
  assert.equal(gate.state, PIPELINE_STATE.NEEDS_INPUT);
  assert.equal(gate.proceed, false);
  assert.match(gate.message || "", /INVALID_REQUIREMENTS|zero testable/i);
}

{
  const derived = ensureAnalystReportActions({
    success: true,
    testable_conditions: [],
    ready_for_test_design: true,
    prerequisites_needed: { blocking: [], non_blocking: [] },
  });
  assert.equal(derived.analyst_report.orchestrator_actions[0].action, "ASK_HUMAN");
  assert.equal(derived.analyst_report.orchestrator_actions[0].blocking, true);
  assert.match(derived.analyst_report.orchestrator_actions[0].detail, /zero validated ACs/i);
}

{
  const story = {
    id: "REQ-ZERO",
    title: "No criteria ticket",
    description: "Just a title and fluff with no business rules.",
    acceptance_criteria_list: [],
    acceptance_criteria_entries: [],
    acceptance_criteria: 0,
    test_cases: [],
    gaps: 1,
    blocking_gaps: 0,
    priority: "Medium",
    status: "Draft",
    issueType: "Requirement",
    components: [],
    labels: [],
    score: "—",
    coverage: 0,
    from_requirements: true,
  };
  wireFarm(story);

  const events = buildEvents(story);
  assert.ok(events.some((e) => e.kind === "run_failed"), "must emit run_failed");
  assert.ok(
    events.some((e) => e.kind === "run_failed" && /invalid_requirements|zero testable/i.test(JSON.stringify(e))),
    "run_failed must cite invalid requirements",
  );
  assert.ok(!events.some((e) => e.kind === "run_end"), "must not emit successful run_end");
  assert.ok(!events.some((e) => e.role === "writer" && e.kind === "agent_assign"), "must not assign Writer");
  assert.ok(!events.some((e) => e.role === "author" && e.kind === "agent_assign"), "must not assign Author");
  assert.ok(
    events.some((e) => e.kind === "prerequisite_input_request" && e.pipeline_state === PIPELINE_STATE.NEEDS_INPUT),
    "must request input with NEEDS_INPUT",
  );
}

console.log("zero-ac-gate tests: ok");
