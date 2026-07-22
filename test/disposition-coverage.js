/** Disposition coverage unit tests. */
import assert from "node:assert/strict";
import {
  checkDispositionCoverage,
  expectedDispositionLines,
  collectDispositionTexts,
} from "../agents/disposition-coverage.js";
import { checkAnalystPromptContract } from "../agents/analyst-contract.js";

const story = {
  acceptance_criteria_entries: [
    { text: "User can reset password with a valid token", source: "Business Rules", section: "business_rules" },
    { text: "System shows clear error when token is expired", source: "Exception Flow", section: "exception_flow" },
    { text: "Unapplied — rate limit TBD", source: "Business Rules", section: "business_rules" },
  ],
};

{
  const lines = expectedDispositionLines(story);
  assert.equal(lines.length, 3);
}

{
  // All three dispositioned — ok
  const parsed = {
    testable_conditions: [
      { id: "AC-1", ac_text: "User can reset password with a valid token" },
    ],
    analyst_reasoning: {
      ambiguous_acs: [{
        ac_id: null,
        source_line: "System shows clear error when token is expired",
        issue: '"clear" is vague',
        question_for_human: "What message text is required?",
      }],
      unimplemented_rules: ["Unapplied — rate limit TBD"],
      rejected_as_non_ac: [],
    },
  };
  const r = checkDispositionCoverage(story, parsed);
  assert.equal(r.ok, true, r.failures.join("; "));
  assert.equal(r.covered_count, 3);
}

{
  // Silent drop — middle line missing
  const parsed = {
    testable_conditions: [
      { id: "AC-1", ac_text: "User can reset password with a valid token" },
    ],
    analyst_reasoning: {
      ambiguous_acs: [],
      unimplemented_rules: ["Unapplied — rate limit TBD"],
      rejected_as_non_ac: [],
    },
  };
  const r = checkDispositionCoverage(story, parsed);
  assert.equal(r.ok, false);
  assert.equal(r.uncovered.length, 1);
  assert.match(r.failures[0], /DISPOSITION/);
}

{
  // Rejected via "line — reason"
  const parsed = {
    testable_conditions: [
      { id: "AC-1", ac_text: "User can reset password with a valid token" },
    ],
    analyst_reasoning: {
      ambiguous_acs: [],
      unimplemented_rules: ["Unapplied — rate limit TBD"],
      rejected_as_non_ac: [
        "System shows clear error when token is expired — rejected: UI copy not specified enough for design",
      ],
    },
  };
  assert.equal(checkDispositionCoverage(story, parsed).ok, true);
}

{
  // Contract with story enforces disposition
  const base = {
    testable_conditions: [{ id: "AC-1", ac_text: "User can reset password with a valid token" }],
    analysis_complete: true,
    ready_for_test_design: true,
    prerequisites_needed: { blocking: [], non_blocking: [] },
    analyst_report: {
      orchestrator_actions: [{ action: "PROCEED", target: "writer", blocking: false }],
      confidence: { overall: "high" },
    },
    analyst_reasoning: {
      ambiguous_acs: [],
      unimplemented_rules: [],
      rejected_as_non_ac: [],
    },
  };
  assert.equal(checkAnalystPromptContract(base).ok, true); // no story → skip disposition
  assert.equal(checkAnalystPromptContract(base, story).ok, false); // silent drops
}

{
  const texts = collectDispositionTexts({
    testable_conditions: [{ ac_text: "Alpha rule one" }],
    analyst_reasoning: {
      ambiguous_acs: [{ source_line: "Beta rule two" }],
      unimplemented_rules: ["Gamma rule three"],
      rejected_as_non_ac: ["Delta rule four — reason"],
    },
  });
  assert.deepEqual(
    texts.sort(),
    ["Alpha rule one", "Beta rule two", "Gamma rule three", "Delta rule four"].sort(),
  );
}

console.log("disposition-coverage tests: ok");
