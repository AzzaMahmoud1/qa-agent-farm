/**
 * Orchestrator as the brain: it judges every agent output, retries or
 * escalates, and is the only thing that hands accepted output to the next
 * agent. Agents are fakes; the judges and the run loop are production code.
 * Run: node test/orchestrator-run.js
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startRun, resumeRun, judgeWriter, STAGES } from "../src/agents/orchestratorRun.js";
import { normalizeSkillPass, assembleAnalystContract } from "../src/agents/requirementAnalyst.js";
import { assembleLiveWriterOutput } from "../src/agents/testWriter.js";

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/analyst-golden/${name}.json`, import.meta.url), "utf8"));
function contractOf(f) {
  const runs = {};
  for (const [k, v] of Object.entries(f.responses)) runs[k] = normalizeSkillPass(k, { text: JSON.stringify(v) }, f.story);
  return assembleAnalystContract(runs, f.story, { runner: "golden" });
}
const clean = fx("clean-lockout");
const ANALYST = contractOf(clean);
const WRITER = assembleLiveWriterOutput(clean.writer_response, ANALYST);
const story = { ticketText: clean.story, ticketId: "AUTH-101", title: "Lockout" };

const verified = (outline) => ({
  success: true, runner: "live", status: "REVIEW", outline_id: outline.id, replay_ok: true,
  steps: [{ kind: "assert", ok: true }], requirement_verdicts: Object.fromEntries(outline.mapped_acs.map((id) => [id, { verdict: "verified" }])),
});

// ── happy path: orchestrator passes the ACCEPTED analyst output to the Writer ─
{
  const seen = {};
  const runners = {
    analyst: async () => ({ parsed: ANALYST }),
    writer: async (input) => { seen.writerInput = input; return WRITER; },
    author: async (input) => { (seen.authored ||= []).push(input.outline.id); return verified(input.outline); },
  };
  const run = await startRun(story, runners);
  assert.equal(run.stage, STAGES.AWAITING_APPROVAL);
  assert.deepEqual(seen.writerInput.analyst, ANALYST, "Writer receives exactly the output the orchestrator accepted");
  assert.equal(seen.writerInput.analyst, run.outputs.analyst, "…from the orchestrator's own copy");
  assert.deepEqual(run.decisions.map((d) => `${d.agent}:${d.verdict}`), ["analyst:accept", "writer:accept"]);

  const again = await resumeRun(run, { approvals: { "TO-01": "approved", "TO-03": "approved", "TO-02": "rejected" }, url: "https://app.example.test/" }, runners);
  assert.equal(again.stage, STAGES.READY_FOR_EXECUTION);
  assert.deepEqual(seen.authored, ["TO-01", "TO-03"], "only human-approved outlines are authored");
  assert.ok(again.decisions.some((d) => d.agent === "author:TO-03" && d.verdict === "accept"));
  await assert.rejects(() => resumeRun(again, { approvals: {}, url: "https://x/" }, runners), /not awaiting outline approval/);
}

// ── bad Analyst output: retried once with the judge's reasons, then escalated ─
{
  const feedback = [];
  const runners = {
    analyst: async (input) => { feedback.push(input.orchestrator_feedback); return { parsed: { success: true, testable_conditions: [] } }; },
    writer: async () => { throw new Error("must not run"); },
  };
  const run = await startRun(story, runners);
  assert.equal(run.stage, STAGES.ESCALATED);
  assert.equal(run.awaiting.agent, "analyst");
  assert.equal(feedback[0], null);
  assert.match(feedback[1].join(" "), /Contract check failed/, "retry carries the orchestrator's reasons");
  assert.deepEqual(run.decisions.map((d) => d.next), ["retry", "escalate"]);
}

// ── NOT_TEST_READY: held for the PO, Writer never runs ───────────────────────
{
  const held = contractOf(fx("vague-no-ac"));
  let writerCalls = 0;
  const run = await startRun({ ...story, ticketText: fx("vague-no-ac").story }, { analyst: async () => ({ parsed: held }), writer: async () => { writerCalls++; } });
  assert.equal(run.stage, STAGES.HELD_FOR_PO);
  assert.equal(writerCalls, 0);
}

// ── Writer output that silently drops an AC is rejected, then fixed on retry ─
{
  const dropped = { ...WRITER, ac_verdicts: { AC1: WRITER.ac_verdicts.AC1 } };
  assert.equal(judgeWriter(dropped, ANALYST).verdict, "retry");
  let n = 0;
  const run = await startRun(story, { analyst: async () => ({ parsed: ANALYST }), writer: async () => (n++ === 0 ? dropped : WRITER) });
  assert.equal(run.stage, STAGES.AWAITING_APPROVAL);
  assert.deepEqual(run.decisions.map((d) => `${d.agent}:${d.verdict}`), ["analyst:accept", "writer:retry", "writer:accept"]);
}

// ── Author: unverified session is retried then escalated; NEEDS_INPUT waits ──
{
  const base = { analyst: async () => ({ parsed: ANALYST }), writer: async () => WRITER };
  const failing = { ...base, author: async ({ outline }) => ({ ...verified(outline), replay_ok: false }) };
  const run = await startRun(story, failing);
  await resumeRun(run, { approvals: { "TO-01": "approved" }, url: "https://app.example.test/" }, failing);
  assert.equal(run.stage, STAGES.ESCALATED);
  assert.match(run.awaiting.detail.join(" "), /not replayed/);

  const needs = { ...base, author: async ({ outline }) => ({ status: "NEEDS_INPUT", outline_id: outline.id, blocked_reason: "Playwright is not installed" }) };
  const run2 = await startRun(story, needs);
  await resumeRun(run2, { approvals: { "TO-01": "approved" }, url: "https://app.example.test/" }, needs);
  assert.equal(run2.stage, STAGES.AWAITING_HUMAN);

  const run3 = await startRun(story, needs);
  await resumeRun(run3, { approvals: {}, url: "https://app.example.test/" }, needs);
  assert.equal(run3.stage, STAGES.AWAITING_APPROVAL, "nothing approved → still waiting");
  await resumeRun(run3, { approvals: { "TO-01": "approved" }, url: "javascript:alert(1)" }, needs);
  assert.match(run3.awaiting.detail, /http\(s\) URL/);
}

console.log("orchestrator-run tests: ok");
