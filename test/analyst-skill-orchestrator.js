/**
 * Analyst skill-orchestrator: skill loading, grounding, tolerant JSON
 * extraction, and deterministic contract assembly. No LLM/network — exercises
 * the pure glue that turns 5 separate grounded skill passes into the pipeline
 * contract the simulator + orchestrator consume.
 * Run: node test/analyst-skill-orchestrator.js
 */
import assert from "node:assert/strict";
import { loadSkill, ANALYST_SKILLS } from "../src/agents/skillLoader.js";
import { normalize, checkQuoteGrounded, groundFindings, MIN_QUOTE_CHARS } from "../src/agents/grounding.js";
import {
  extractSkillJson,
  assembleAnalystContract,
  validateAnalystOutput,
} from "../src/agents/requirementAnalyst.js";
import { checkAnalystPromptContract } from "../agents/analyst-contract.js";

const STORY = [
  "Title: Account lockout",
  "Description: After 5 failed login attempts the account must be locked for 15 minutes.",
  "The system displays an error message when the account is locked.",
].join("\n");

// ── skillLoader ──────────────────────────────────────────────────────────────
{
  const skill = loadSkill("requirements_analysis");
  assert.equal(skill.name, "requirements_analysis");
  assert.match(skill.instructions, /acceptance criteria/i, "loads the SKILL.md body");
  assert.ok(skill.schema && typeof skill.schema === "object", "loads the output schema when present");
  for (const name of Object.keys(ANALYST_SKILLS)) {
    assert.doesNotThrow(() => loadSkill(name), `all 5 skills must load: ${name}`);
  }
}

// ── grounding ────────────────────────────────────────────────────────────────
{
  assert.equal(normalize("  The  ACCOUNT   is\nlocked "), "the account is locked");
  assert.ok(checkQuoteGrounded("the account must be locked", STORY).ok, "verbatim quote is grounded");
  assert.ok(!checkQuoteGrounded("the account gets frozen", STORY).ok, "paraphrase is rejected");
  assert.ok(!checkQuoteGrounded("locked", STORY).ok, `quote under ${MIN_QUOTE_CHARS} chars rejected`);

  const { kept, dropped } = groundFindings(
    [
      { evidence_quote: "the account must be locked" },  // real
      { evidence_quote: "sends an email to the admin" },  // invented
    ],
    STORY,
  );
  assert.equal(kept.length, 1, "keeps only grounded findings");
  assert.equal(dropped.length, 1, "drops the ungrounded (hallucinated) finding");
}

// ── tolerant JSON extraction ─────────────────────────────────────────────────
{
  assert.deepEqual(extractSkillJson('{"status":"success"}'), { status: "success" }, "bare JSON");
  assert.deepEqual(extractSkillJson('```json\n{"status":"success"}\n```'), { status: "success" }, "fenced JSON");
  assert.deepEqual(
    extractSkillJson('Here is my answer:\n{"status":"success","risks":[]}\nDone.'),
    { status: "success", risks: [] },
    "prose-wrapped JSON",
  );
  assert.throws(() => extractSkillJson("not json at all"), /no parseable JSON/);
}

// helpers to build mock grounded skill runs (shape of normalizeSkillPass output)
function reqRun({ acs = [], status = "success", conf = 0.9, review = false, missing = [] } = {}) {
  return {
    skill: "requirements_analysis", ran: true, status, findings: acs,
    dropped_ungrounded: 0, grounding_failures: [], overall_confidence: conf,
    requires_human_review: review, missing_information: missing, advisory: false, raw: {},
  };
}
function riskRun(risks = []) {
  return {
    skill: "risk_analysis", ran: true, status: risks.length ? "success" : "insufficient_information",
    findings: risks, dropped_ungrounded: 0, grounding_failures: [], overall_confidence: 0.8,
    requires_human_review: false, missing_information: [], advisory: true, raw: {},
  };
}
function gapRun(gaps = []) {
  return {
    skill: "test_gap_analysis", ran: true, status: gaps.length ? "success" : "insufficient_information",
    findings: gaps, dropped_ungrounded: 0, grounding_failures: [], overall_confidence: 0.8,
    requires_human_review: false, missing_information: [], advisory: true, raw: {},
  };
}
const AC1 = { statement: "Account locks after 5 failed attempts", evidence_quote: "the account must be locked", source_field: "description", confidence: 0.95 };
const AC2 = { statement: "Error message shown when locked", evidence_quote: "displays an error message when the account is locked", source_field: "description", confidence: 0.9 };

// ── assemble: PROCEED path ───────────────────────────────────────────────────
{
  const runs = {
    requirements_analysis: reqRun({ acs: [AC1, AC2] }),
    risk_analysis: riskRun([
      { risk: "Lockout bypass", likelihood: "medium", impact: "high", evidence_quote: "the account must be locked" },
    ]),
    test_gap_analysis: gapRun([
      { uncovered_element: "attempt counter", technique: "boundary_value", gap: "no test for the 5th attempt boundary", severity: "high", evidence_quote: "After 5 failed login attempts" },
    ]),
  };
  const parsed = assembleAnalystContract(runs, STORY);
  assert.doesNotThrow(() => validateAnalystOutput(parsed), "PROCEED output passes the full contract");
  assert.equal(parsed.ready_for_test_design, true);
  assert.equal(parsed.testable_conditions.length, 2);
  assert.ok(parsed.analyst_report.orchestrator_actions.some((a) => a.action === "PROCEED"), "emits PROCEED");
  const ac1 = parsed.testable_conditions[0];
  assert.equal(ac1.risk, "P1", "medium×high risk maps to P1");
  assert.ok(checkAnalystPromptContract(parsed).ok, "second-opinion contract also passes");
}

// ── assemble: abstain (no ACs) → blocking ASK_HUMAN, no PROCEED ───────────────
{
  const runs = {
    requirements_analysis: reqRun({ acs: [], status: "insufficient_information", conf: 0.3, missing: ["Lockout duration is not stated in the ticket"] }),
    risk_analysis: riskRun([]),
    test_gap_analysis: gapRun([]),
  };
  const parsed = assembleAnalystContract(runs, STORY);
  assert.doesNotThrow(() => validateAnalystOutput(parsed), "abstain output passes the contract");
  assert.equal(parsed.ready_for_test_design, false);
  assert.equal(parsed.testable_conditions.length, 0);
  const actions = parsed.analyst_report.orchestrator_actions;
  assert.ok(!actions.some((a) => a.action === "PROCEED"), "never PROCEED with zero ACs");
  assert.ok(actions.some((a) => a.action === "ASK_HUMAN" && a.blocking === true), "blocking ASK_HUMAN raised");
  assert.equal(parsed.prerequisites_needed.blocking.length, 1, "a blocking prereq is recorded");
}

// ── assemble: grounded ACs but low confidence → HOLD, no PROCEED ──────────────
{
  const runs = {
    requirements_analysis: reqRun({ acs: [AC1], conf: 0.6 }),
    risk_analysis: riskRun([]),
    test_gap_analysis: gapRun([]),
  };
  const parsed = assembleAnalystContract(runs, STORY);
  assert.doesNotThrow(() => validateAnalystOutput(parsed), "low-confidence output passes the contract");
  assert.equal(parsed.ready_for_test_design, false);
  const actions = parsed.analyst_report.orchestrator_actions;
  assert.ok(actions.some((a) => a.action === "HOLD" && a.blocking === true), "HOLD raised on low confidence");
  assert.ok(!actions.some((a) => a.action === "PROCEED"), "low confidence cannot PROCEED");
}

// ── assemble: visual (image-derived) AC → PROCEED + confirming ASK_HUMAN ──────
{
  const visualAC = { statement: "Lock banner matches the mockup", evidence_quote: "displays an error message when the account is locked", source_field: "attachment:mockup.png", confidence: 0.9 };
  const runs = {
    requirements_analysis: reqRun({ acs: [visualAC] }),
    risk_analysis: riskRun([]),
    test_gap_analysis: gapRun([]),
  };
  const parsed = assembleAnalystContract(runs, STORY);
  assert.doesNotThrow(() => validateAnalystOutput(parsed), "visual PROCEED needs a confirming ASK_HUMAN to pass");
  assert.equal(parsed.ready_for_test_design, true);
  assert.equal(parsed.testable_conditions[0].visual, true);
  const actions = parsed.analyst_report.orchestrator_actions;
  assert.ok(actions.some((a) => a.action === "PROCEED"), "proceeds");
  assert.ok(actions.some((a) => a.action === "ASK_HUMAN"), "with a confirming ASK_HUMAN for the visual reading");
}

console.log("analyst-skill-orchestrator tests: ok");
