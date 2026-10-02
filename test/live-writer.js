/**
 * Live Writer: code-side validation of the model's test cases, the prompt
 * contract, the retry path, and the stub/live handoff in agents/writer.js.
 * No network — the LLM call is injected.
 * Run: node test/live-writer.js
 */
import assert from "node:assert/strict";
import { assembleLiveWriterOutput, runLiveWriter, buildWriterPrompt } from "../src/agents/testWriter.js";
import { buildWriterOutput } from "../agents/writer.js";
import { checkIoConsistency, HANDOFF } from "../agents/io-consistency.js";

const ANALYST = {
  success: true,
  ready_for_test_design: true,
  testable_conditions: [
    { id: "AC1", ac_text: "Account locks for 15 minutes after 5 failed logins", evidence_quote: "After 5 failed login attempts the account must be locked for 15 minutes", risk: "P1" },
    { id: "AC2", ac_text: "MSG01 shown when locked", evidence_quote: "displays MSG01 \"Your account is locked\"", risk: null },
    { id: "AC3", ac_text: "Status becomes Locked", evidence_quote: "red banner on the mockup", risk: "P2", provisional: true },
  ],
};

const MODEL = {
  test_cases: [
    { ac_ref: "AC1", title: "Verify that the account locks after 5 failures", type: "edge_case", technique: "bva", risk: "P3",
      given: "An account with 4 failed attempts", when: "A 5th wrong password is submitted", then: "The account is locked",
      evidence_citation: "After 5 failed login attempts the account must be locked" },
    { ac_ref: "AC2", title: "MSG01 copy", given: "A locked account", when: "The user opens login", then: "MSG01 is shown",
      evidence_citation: "the login page shows a friendly message" }, // not verbatim → dropped
    { ac_ref: "AC9", title: "Verify that admins are emailed", given: "g", when: "w", then: "t", evidence_citation: "admins are emailed on lock" }, // invented AC → dropped
    { ac_ref: "AC3", title: "Verify that the status becomes Locked", type: "happy_path", given: "A locked account", when: "Status is viewed",
      then: "Status shows Locked", evidence_citation: "Status becomes Locked" },
  ],
  skipped: [],
};

// ── validation + assembly ────────────────────────────────────────────────────
{
  const out = assembleLiveWriterOutput(MODEL, ANALYST);
  assert.equal(out.runner, "live");
  assert.equal(out.test_cases.length, 2, "invented AC and non-verbatim citation dropped");
  assert.equal(out.dropped_invalid.length, 2);
  const [tc1, tc3] = out.test_cases;
  assert.equal(tc1.risk, "P1", "risk copied from the Analyst, model's P3 ignored");
  assert.equal(tc1.priority, "High");
  assert.equal(tc1.technique, "BVA");
  assert.equal(tc3.traceability, "Provisional");
  assert.match(tc3.title, /\[Provisional\]$/);
  assert.equal(out.ac_verdicts.AC2.verdict, "skipped", "condition with no valid case gets an explicit skip");
  assert.ok(out.ac_verdicts.AC2.skip_reason);
  assert.equal(out.requires_human_review, true);
  assert.deepEqual(out.coverage_matrix, { AC1: ["TO-01"], AC3: ["TO-02"] });
  assert.ok(out.test_outlines.every((o) => o.status === "draft"), "outlines still need human approval");
}

// ── prompt carries skill + data fences, not model-facing risk instructions ───
{
  const prompt = buildWriterPrompt(ANALYST, "Story text");
  assert.match(prompt, /# Test Case Writer/);
  assert.match(prompt, /<<<CONDITIONS[\s\S]*"AC3"[\s\S]*CONDITIONS>>>/);
  assert.match(prompt, /<<<STORY\nStory text\nSTORY>>>/);
}

// ── runLiveWriter: one corrective retry on unparseable output ────────────────
{
  const calls = [];
  const call = async (prompt, attempt) => {
    calls.push(attempt);
    return { text: attempt === 1 ? "sorry, here you go" : JSON.stringify(MODEL) };
  };
  const out = await runLiveWriter(ANALYST, "story", { call });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(out.success, true);

  const none = await runLiveWriter({ testable_conditions: [] }, "story", { call });
  assert.equal(none.success, false, "no conditions → no live Writer");
}

// ── stub/live handoff ────────────────────────────────────────────────────────
{
  const live = assembleLiveWriterOutput(MODEL, ANALYST);
  const story = { id: "AUTH-101", live_writer_output: live };
  const used = buildWriterOutput(story, ANALYST);
  assert.equal(used.runner, "live", "matching conditions → live output used");
  used.test_outlines[0].status = "approved";
  assert.equal(story.live_writer_output.test_outlines[0].status, "draft", "approvals don't mutate the cached live result");

  const otherAnalyst = { ...ANALYST, testable_conditions: ANALYST.testable_conditions.slice(0, 2) };
  assert.equal(buildWriterOutput(story, otherAnalyst).runner, "stub", "stale live output (different ACs) is not used");

  const stub = buildWriterOutput({ id: "X" }, ANALYST);
  const stubTc3 = stub.test_cases.find((t) => t.ac_ref === "AC3");
  assert.equal(stub.test_cases.find((t) => t.ac_ref === "AC1").risk, "P1", "stub Writer carries Analyst risk");
  assert.equal(stub.test_cases.find((t) => t.ac_ref === "AC2").risk, null, "stub Writer never invents risk");
  assert.match(stubTc3.title, /\[Provisional\]$/);

  const io = checkIoConsistency(HANDOFF.ANALYST_WRITER, { story, analyst: ANALYST, writer: used });
  assert.ok(io.structural_ok, `live Writer output passes Analyst→Writer IO checks: ${io.failures?.join("; ")}`);
}

console.log("live-writer tests: ok");
