/**
 * Analyst golden set. Each fixture in test/fixtures/analyst-golden/ holds a
 * story, the recorded raw model output per skill, and the expected contract.
 *
 * Default (offline, in `npm test`): replay the recorded outputs through the
 * real grounding → rule checks → scoring → assembly code.
 * Live (`ANALYST_GOLDEN_LIVE=1 node test/analyst-golden.js`): run the real
 * analyst on each story with the configured runner and compare the verdict,
 * readiness and condition count — use this to check a skill edit.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeSkillPass,
  assembleAnalystContract,
  validateAnalystOutput,
  runRequirementAnalyst,
} from "../src/agents/requirementAnalyst.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/analyst-golden");
const LIVE = process.env.ANALYST_GOLDEN_LIVE === "1";
const fixtures = readdirSync(DIR).filter((f) => f.endsWith(".json"))
  .map((f) => ({ name: f.replace(/\.json$/, ""), ...JSON.parse(readFileSync(join(DIR, f), "utf8")) }));

function replay(fx) {
  const runs = {};
  for (const [skill, raw] of Object.entries(fx.responses)) {
    runs[skill] = normalizeSkillPass(skill, { text: JSON.stringify(raw) }, fx.story);
  }
  return { parsed: assembleAnalystContract(runs, fx.story, { runner: "golden" }), runs };
}

let failed = 0;
for (const fx of fixtures) {
  const e = fx.expect;
  try {
    const { parsed, runs } = LIVE ? await runRequirementAnalyst(fx.story).then((r) => ({ parsed: r.parsed, runs: r.skill_runs || {} })) : replay(fx);
    assert.ok(parsed, "analyst returned a contract");
    validateAnalystOutput(parsed);
    assert.equal(parsed.testability?.verdict ?? null, e.verdict, "testability verdict");
    assert.equal(parsed.ready_for_test_design, e.ready_for_test_design, "ready_for_test_design");
    if (!LIVE) {
      assert.equal(parsed.testable_conditions.length, e.conditions, "condition count");
      const actions = parsed.analyst_report.orchestrator_actions.map((a) => a.action);
      assert.deepEqual(actions, e.actions, "orchestrator actions");
      if (e.risks) assert.deepEqual(parsed.testable_conditions.map((c) => c.risk), e.risks, "derived risk priorities");
      if (e.coverage_gaps != null) assert.equal(parsed.coverage_gaps.length, e.coverage_gaps);
      if (e.knockouts) assert.deepEqual(parsed.testability.knockouts, e.knockouts);
      if (e.conflicts != null) assert.equal(parsed.conflicts.length, e.conflicts);
      if (e.dropped_ungrounded != null) assert.equal(runs.requirements_analysis.dropped_ungrounded, e.dropped_ungrounded);
    } else if (e.conditions > 0) {
      // Live models vary in granularity; require the right order of magnitude.
      const n = parsed.testable_conditions.length;
      assert.ok(n >= Math.ceil(e.conditions / 2) && n <= e.conditions * 2, `condition count ${n} far from expected ${e.conditions}`);
    }
    console.log(`  ✓ ${fx.name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${fx.name}: ${err.message}`);
  }
}

if (failed) {
  console.error(`analyst-golden${LIVE ? " (live)" : ""}: ${failed}/${fixtures.length} failed`);
  process.exit(1);
}
console.log(`analyst-golden${LIVE ? " (live)" : ""} tests: ok (${fixtures.length} stories)`);
