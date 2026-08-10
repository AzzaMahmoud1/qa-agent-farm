import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  getTicketMemory,
  recordRunOutcome,
  inferOutcomeFromEvents,
  summarizePriorMemoryForOrchestrator,
} from "../lib/farm-state.js";

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

const { resolvePipelineEvents } = await import(
  pathToFileURL(path.join(root, "agents/orchestrator.js")).href
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "farm-state-"));
const statePath = path.join(tmp, "state.json");

assert.equal(getTicketMemory("NOPE", statePath), null);

recordRunOutcome({
  ticketId: "TICK-1",
  finalGateOutcome: "waiting_on_human",
  blockingPrerequisites: [{ id: "access-webpage-url", item: "UI access — page URL", category: "environment" }],
  decision: "ASK_HUMAN",
  why: "needs URL",
}, statePath);

const mem1 = getTicketMemory("TICK-1", statePath);
assert.equal(mem1.final_gate_outcome, "waiting_on_human");
assert.equal(mem1.blocking_prerequisites.length, 1);
assert.equal(mem1.decision_log.length, 1);

const prior = summarizePriorMemoryForOrchestrator("TICK-1", statePath);
assert.equal(prior.prior_run, true);
assert.equal(prior.known_blocking_prerequisites[0].id, "access-webpage-url");

assert.equal(inferOutcomeFromEvents([{ kind: "run_end" }]), "goal_achieved");
assert.equal(
  inferOutcomeFromEvents([{ kind: "run_failed", agent_returns: { reason: "validator_brake" } }]),
  "validator_brake",
);

const story = {
  id: "TICK-1",
  title: "Login",
  description: "User can log in",
  acceptance_criteria: 1,
  acceptance_criteria_list: ["User can log in with valid credentials on the login page"],
  test_cases: [],
  gaps: "0",
  blocking_gaps: 0,
  priority: "High",
  issueType: "Story",
  status: "Open",
  components: [],
  score: "A",
  coverage: 80,
  from_requirements: true,
};

const events = resolvePipelineEvents(story, { statePath, persistState: true });
assert.ok(events[0]?.farm_memory?.prior_run === true);
const after = getTicketMemory("TICK-1", statePath);
assert.ok(after.decision_log.length >= 2);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("farm-state tests: ok");
