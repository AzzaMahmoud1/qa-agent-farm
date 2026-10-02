/**
 * End-to-end golden run: story → live Analyst (replayed) → Validator →
 * live Writer (replayed) → outline approval → live Author (fake browser) →
 * Executor → Reviewer → Reporter, through the real orchestrator.
 *
 * Only the LLM text and the browser are faked; every gate, contract and
 * event builder is the production code. Fixtures with an `e2e` block in
 * test/fixtures/analyst-golden/ are run; a NOT_TEST_READY fixture checks the
 * pipeline never reaches the Writer.
 * Run: node test/e2e-golden.js
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const prerequisites = require("../lib/prerequisites.cjs");
const { setFarmCtx } = await import("../agents/ctx-bridge.js");

const WEB = { ok: true, url: "https://app.example.test/login", title: "Login", origin: "https://app.example.test", path: "/login" };
setFarmCtx({
  prerequisites,
  storyRequiresApi: () => false,
  storyRequiresWebpage: () => true,
  isRequiredInputReady: () => true,
  isHumanInputSatisfied: () => true,
  humanApiInput: { ok: false },
  humanWebpageInput: WEB,
  getLiveHumanInputNeed: () => ({ needsHumanInput: true, types: ["webpage"] }),
  getProvidedPrerequisites: () => [],
  EVENTS: [],
  currentStory: null,
  storyOutputs: {},
  executionResult: null,
});

const { normalizeSkillPass, assembleAnalystContract } = await import("../src/agents/requirementAnalyst.js");
const { assembleLiveWriterOutput } = await import("../src/agents/testWriter.js");
const { runAuthorSession } = await import("../src/agents/liveAuthor.js");
const { buildEvents, buildEventsAfterHumanApiInput } = await import("../agents/orchestrator.js");
const { buildWriterOutput } = await import("../agents/writer.js");

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/analyst-golden");
const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "baseline.json")
  .map((f) => ({ name: f.replace(/\.json$/, ""), ...JSON.parse(readFileSync(join(DIR, f), "utf8")) }));

const sig = (e) => `${e.kind}${e.role ? `:${e.role}` : ""}`;

function analystFor(fx) {
  const runs = {};
  for (const [skill, raw] of Object.entries(fx.responses)) {
    runs[skill] = normalizeSkillPass(skill, { text: JSON.stringify(raw) }, fx.story);
  }
  return assembleAnalystContract(runs, fx.story, { runner: "golden" });
}

/** Fake browser whose page shows each outline's validation text once acted on. */
function fakeDriver(validationText) {
  const st = { url: WEB.url, text: "Login" };
  return {
    async goto(url) { st.url = url; st.text = "Login"; },
    async snapshot() { return { url: st.url, title: "App", text: st.text, elements: [{ ref: "e1", role: "button", name: "Go" }] }; },
    async act() { st.text = `Done. ${validationText}`; },
    async screenshot() { return null; },
    async close() {},
  };
}

let ran = 0;
for (const fx of fixtures) {
  const contract = analystFor(fx);
  const story = {
    id: fx.name.toUpperCase(), title: fx.name, description: fx.story, acceptance_criteria_list: [],
    test_cases: [], from_requirements: true, priority: "High", status: "Ready",
    live_analyst_output: contract,
  };

  if (fx.expect.verdict === "NOT_TEST_READY") {
    const events = buildEvents(story);
    assert.ok(!events.some((e) => e.kind === "agent_assign" && e.role === "writer"), `${fx.name}: held story never reaches the Writer`);
    console.log(`  ✓ ${fx.name} (held before Writer)`);
    ran++;
    continue;
  }
  if (!fx.e2e) continue;

  // 1. Analyst → Validator → Writer → … → Author hold (no browser run yet)
  story.live_writer_output = assembleLiveWriterOutput(fx.writer_response, contract);
  const events = buildEvents(story);
  const sigs = events.map(sig);
  assert.ok(!sigs.includes("validator_brake:validator"), `${fx.name}: live Analyst passes the Validator first time`);
  const writerReturn = events.find((e) => e.kind === "agent_return" && e.role === "writer").agent_returns;
  assert.equal(writerReturn.runner, "live", `${fx.name}: pipeline used the live Writer`);
  assert.ok(writerReturn.test_cases.every((t) => t.evidence_citation), "every case cites the Analyst");
  assert.equal(sigs.at(-1), "pipeline_hold", `${fx.name}: Author holds until a verified browser run`);

  // 2. Human approves an outline; live Author verifies it in the (fake) browser.
  const writer = buildWriterOutput(story, contract);
  const outline = writer.test_outlines.find((o) => o.id === fx.e2e.author_outline);
  outline.status = "approved";
  const planner = async ({ snapshot, validation }) => (snapshot.text === "Login"
    ? { action: { type: "click", ref: "e1" } }
    : { done: true, assertion: { type: "text_visible", value: validation } });
  story.live_author_output = await runAuthorSession({ outline, url: WEB.url, driver: fakeDriver(outline.tasks[0].validation), planner });
  assert.equal(story.live_author_output.status, fx.e2e.expect_author, story.live_author_output.blocked_reason);

  // 3. Resume downstream: REVIEW unlocks Executor → Reviewer → Reporter → run end.
  const after = buildEventsAfterHumanApiInput(story, contract, writer).map(sig);
  for (const want of fx.e2e.expect_events) {
    assert.ok(after.includes(want), `${fx.name}: expected ${want} after a verified Author run — got ${after.join(", ")}`);
  }
  console.log(`  ✓ ${fx.name} (story → … → ${after.at(-1)})`);
  ran++;
}

assert.ok(ran >= 2, "at least one full and one held e2e story ran");
console.log(`e2e-golden tests: ok (${ran} stories)`);
