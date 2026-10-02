/**
 * Code-side enforcement of the analysis-skill rules: testability scoring +
 * knockouts, per-skill rule checks, image-evidence grounding, no invented
 * priority, conflicts, and the NOT_TEST_READY hold. No LLM/network.
 * Run: node test/analyst-skill-checks.js
 */
import assert from "node:assert/strict";
import { scoreTestability, applySkillRules, TESTABILITY_WEIGHTS } from "../src/agents/skillChecks.js";
import { groundFindings } from "../src/agents/grounding.js";
import { loadSkill } from "../src/agents/skillLoader.js";
import {
  normalizeSkillPass,
  assembleAnalystContract,
  validateAnalystOutput,
  securityRiskContext,
} from "../src/agents/requirementAnalyst.js";

const all = (result) => Object.keys(TESTABILITY_WEIGHTS).map((id) => ({ id, result }));
const call = (obj) => ({ text: JSON.stringify(obj) });

// ── testability scoring ──────────────────────────────────────────────────────
{
  assert.equal(Object.values(TESTABILITY_WEIGHTS).reduce((a, b) => a + b, 0), 100, "weights sum to 100");
  const perfect = scoreTestability(all("met"));
  assert.equal(perfect.overall_score, 100);
  assert.equal(perfect.verdict, "TEST_READY");
  assert.deepEqual(perfect.section_totals, { user_story: 55, testability: 30, requirements: 15 });

  // No testable AC: weighted total is still Fair, but the knockout blocks.
  const noAc = all("met").map((c) => (c.id === "US-3" || c.id === "T-2" ? { ...c, result: "not_met" } : c));
  const s = scoreTestability(noAc);
  assert.equal(s.overall_score, 78);
  assert.equal(s.verdict, "NOT_TEST_READY", "US-3/T-2 knockout overrides the total");
  assert.deepEqual(s.knockouts, ["US-3", "T-2"]);

  const half = scoreTestability(all("partial"));
  assert.equal(half.overall_score, 50);
  assert.equal(half.verdict, "NOT_TEST_READY");

  const omitted = scoreTestability([{ id: "US-1", result: "met" }]);
  assert.equal(omitted.overall_score, 11, "omitted criteria score not_met, never inflated");
  assert.equal(omitted.missing_criteria.length, 14);
}

// ── per-skill rules ──────────────────────────────────────────────────────────
{
  const hh = { likelihood: "high", impact: "high" };
  assert.equal(applySkillRules("risk_analysis", [hh, hh, hh]).violations.length, 1, "all high×high rejected");
  assert.equal(applySkillRules("risk_analysis", [hh, hh, { likelihood: "low", impact: "high" }]).violations.length, 0);

  const bv = { technique: "boundary_value" };
  assert.equal(applySkillRules("test_gap_analysis", [bv, bv, bv, bv], {}).violations.length, 1, "single lens rejected");
  assert.equal(applySkillRules("test_gap_analysis", [bv, bv, bv, bv], { missing_information: ["only numeric ranges in story"] }).violations.length, 0, "explained single lens allowed");

  const rcNoEvidence = { root_cause: "x", why_chain: [{ support: "hypothesis" }], confidence: 0.5 };
  const rcOverconfident = { root_cause: "y", why_chain: [{ support: "evidenced" }, { support: "hypothesis" }, { support: "hypothesis" }], confidence: 0.9 };
  const rc = applySkillRules("root_cause_analysis", [rcNoEvidence, rcOverconfident]);
  assert.equal(rc.findings.length, 1, "chain with no evidenced step dropped");
  assert.ok(rc.findings[0].confidence < 0.75, "mostly-hypothesis chain capped");
  assert.equal(rc.violations.length, 2);
}

// ── grounding: image evidence only when images were actually sent ────────────
{
  const imgFinding = { evidence_quote: "red banner reading Account locked", source_field: "attachment:mockup.png" };
  assert.equal(groundFindings([imgFinding], "story text").kept.length, 0, "no images sent → dropped");
  const { kept } = groundFindings([imgFinding], "story text", "evidence_quote", { imageEvidence: true });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].provisional, true);
  assert.equal(kept[0].evidence_kind, "image");
}

// ── skill loading: COMMON.md prefixed; root cause lives with the reviewer ────
{
  const t = loadSkill("testability_analysis");
  assert.match(t.instructions, /Rules for every analysis pass/, "shared rules prefixed");
  assert.match(loadSkill("root_cause_analysis").path, /qa-reviewer/);
}

const STORY = [
  "Title: Account lockout",
  "Description: As a customer I want my account locked after 5 failed login attempts so that it is protected.",
  "After 5 failed attempts the account must be locked for 30 minutes.",
  "Comment 1: PO says lock it for 60 minutes instead.",
  "Comment 2: The login screen displays an error message when the account is locked.",
].join("\n");

// ── source_analysis findings reach the contract (findingsKey fix) ────────────
{
  const run = normalizeSkillPass("source_analysis", call({
    status: "success",
    changed_surfaces: [{ surface: "lockout", change_type: "added", observable_effect: "locks", evidence_quote: "the account must be locked for 30 minutes", source_field: "description" }],
    overall_confidence: 0.8,
  }), STORY);
  assert.equal(run.findings.length, 1, "changed_surfaces is read, not dropped");
}

// ── risk with an unknown axis gets no priority (never a default) ─────────────
const req = (extra = {}) => normalizeSkillPass("requirements_analysis", call({
  status: "success",
  acceptance_criteria: [{ statement: "Error shown when locked", evidence_quote: "displays an error message when the account is locked", source_field: "comments[1]", confidence: 0.9 }],
  overall_confidence: 0.9,
  ...extra,
}), STORY);
{
  const risk = normalizeSkillPass("risk_analysis", call({
    status: "success",
    risks: [{ risk: "r", likelihood: "unknown", impact: "high", evidence_quote: "displays an error message when the account is locked", source_field: "comments[1]" }],
    overall_confidence: 0.8,
  }), STORY);
  const parsed = assembleAnalystContract({ requirements_analysis: req(), risk_analysis: risk }, STORY);
  assert.equal(parsed.testable_conditions[0].risk, null, "unknown likelihood → no invented P2");
}

// ── per-criterion conflicts: other ACs proceed, a decision is requested ──────
{
  const run = req({
    conflicts: [{ topic: "lockout duration", quotes: [
      { evidence_quote: "account must be locked for 30 minutes", source_field: "description" },
      { evidence_quote: "lock it for 60 minutes instead", source_field: "comments[0]" },
    ] }],
  });
  assert.equal(run.conflicts.length, 1, "grounded conflict kept");
  const parsed = assembleAnalystContract({ requirements_analysis: run }, STORY);
  assert.doesNotThrow(() => validateAnalystOutput(parsed));
  assert.equal(parsed.ready_for_test_design, true, "unaffected criterion still proceeds");
  assert.ok(parsed.analyst_report.orchestrator_actions.some((a) => a.action === "ASK_HUMAN" && /conflicting/.test(a.detail)));
  assert.equal(parsed.analyst_reasoning.ambiguous_acs.length, 1);

  const invented = req({ conflicts: [{ topic: "x", quotes: [{ evidence_quote: "locked for ninety minutes", source_field: "d" }, { evidence_quote: "lock it for 60 minutes instead", source_field: "c" }] }] });
  assert.equal(invented.conflicts.length, 0, "conflict with an ungrounded quote dropped");
}

// ── testability gate in the contract ─────────────────────────────────────────
{
  const held = normalizeSkillPass("testability_analysis", call({
    status: "success",
    criteria: all("met").map((c) => (c.id === "US-3" ? { ...c, result: "not_met" } : c)),
    defects: [{ severity: "critical", location: "AC", issue: "No acceptance criteria", evidence_quote: "so that it is protected", source_field: "description" }],
    overall_confidence: 0.8,
  }), STORY);
  assert.equal(held.score.verdict, "NOT_TEST_READY");
  assert.equal(held.requires_human_review, true, "blocking gate always needs a human");
  const parsed = assembleAnalystContract({ testability_analysis: held }, STORY);
  assert.doesNotThrow(() => validateAnalystOutput(parsed), "HOLD contract is valid");
  assert.equal(parsed.ready_for_test_design, false);
  assert.ok(parsed.analyst_report.orchestrator_actions.some((a) => a.action === "HOLD" && a.blocking));
  assert.equal(parsed.testability.knockouts[0], "US-3");

  const fair = normalizeSkillPass("testability_analysis", call({
    status: "success",
    criteria: all("met").map((c) => (["US-4", "US-5", "R-2", "R-3", "T-3"].includes(c.id) ? { ...c, result: "not_met" } : c)),
    defects: [{ severity: "major", location: "story", issue: "No priority", evidence_quote: "Title: Account lockout", source_field: "title" }],
    overall_confidence: 0.8,
  }), STORY);
  assert.equal(fair.score.verdict, "NEEDS_REFINEMENT");
  const p2 = assembleAnalystContract({ testability_analysis: fair, requirements_analysis: req() }, STORY);
  assert.equal(p2.ready_for_test_design, true, "Fair still proceeds");
  assert.equal(p2.analyst_report.confidence.overall, "medium", "Fair caps confidence at medium");
  assert.ok(p2.prerequisites_needed.non_blocking.some((n) => /Testability defect/.test(n.detail)), "defects carried forward");
}

// ── security context only for auth/API stories ───────────────────────────────
{
  assert.match(securityRiskContext("User login with session token"), /NCA ECC/);
  assert.equal(securityRiskContext("Change the footer colour to blue"), "");
}

console.log("analyst-skill-checks tests: ok");
