/**
 * Upstream validated-output dependency gate.
 * Run: node test/dependency-gate.js
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

const {
  buildEvents,
  buildEventsAfterHumanPrerequisites,
  resolvePipelineEvents,
  assertCanAssign,
  isApprovableOutput,
  hasStructuredOutput,
  deriveValidatedRolesFromEvents,
} = await import(pathToFileURL(path.join(root, "agents/orchestrator.js")).href);

const story = {
  id: "REQ-DEP",
  title: "Admin can view organization subscriptions",
  description: "As a System Admin I want to view subscriptions. Pre-conditions: User logged in as System Admin.",
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

{
  // Writer cannot assign without validated Analyst
  const denied = assertCanAssign("writer", {
    storyOutputs: {},
    validatedRoles: new Set(),
    pipelineState: "READY_FOR_WRITER",
  });
  assert.equal(denied.ok, false);
  assert.match(denied.blocked_reason, /Analyst/i);
}

{
  const events = buildEvents(story);
  const writerAssign = events.find((e) => e.kind === "agent_assign" && e.role === "writer");
  const humanWait = events.some((e) => e.kind === "prerequisite_input_request");

  if (humanWait) {
    // Truncated: no Writer until human unlocks
    assert.equal(writerAssign, undefined, "Writer must not be pre-built while human gate is open");
    assert.ok(!events.some((e) => e.kind === "prerequisite_input_received"));

    const after = buildEventsAfterHumanPrerequisites(story);
    assert.ok(after.some((e) => e.kind === "prerequisite_input_received"));
    assert.ok(after.some((e) => e.kind === "agent_assign" && e.role === "writer"));

    // Author stub is not approvable → no Executor
    const authorReturn = after.find((e) => e.kind === "agent_return" && e.role === "author");
    assert.ok(authorReturn);
    assert.equal(isApprovableOutput("author", authorReturn.agent_returns), false);
    assert.ok(
      after.some((e) => e.kind === "pipeline_hold" && e.target_agent === "author")
      || after.some((e) => e.kind === "validator_return" && e.target_agent === "author" && !e.passed),
    );
    assert.ok(
      !after.some((e) => e.kind === "agent_assign" && e.role === "test_executor"),
      "Executor must not run without validated Author",
    );
  } else {
    // No human wait: Writer present after Analyst validated; Author hold still blocks Executor
    assert.ok(writerAssign, "Writer should run when Analyst validated and no human wait");
    const validated = deriveValidatedRolesFromEvents(events);
    assert.ok(validated.has("analyst"));
    assert.ok(
      !events.some((e) => e.kind === "agent_assign" && e.role === "test_executor")
      || events.some((e) => e.kind === "pipeline_hold"),
      "Executor must not run past blocked Author",
    );
  }
}

{
  assert.equal(hasStructuredOutput("analyst", { testable_conditions: [] }), false);
  assert.equal(hasStructuredOutput("analyst", { testable_conditions: [{ id: "AC-1" }] }), true);
  assert.equal(
    isApprovableOutput("author", { success: false, blocked: true, status: "PLAN_READY", outlines: [] }),
    false,
  );
  assert.equal(
    isApprovableOutput("author", { success: true, blocked: false, status: "REVIEW", outlines: [{}] }),
    true,
  );
}

{
  const demo = resolvePipelineEvents(story, { demo: "requirements" });
  assert.ok(
    demo.some((e) => e.kind === "run_failed" || e.kind === "validator_brake" || e.brake_applied),
    "requirements demo still aborts",
  );
  assert.ok(
    !demo.some((e) => e.kind === "agent_assign" && e.role === "writer"),
    "requirements demo must not reach Writer",
  );
}

console.log("dependency-gate tests: ok");
