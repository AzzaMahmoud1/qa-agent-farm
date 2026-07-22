#!/usr/bin/env node
/**
 * Requirements pipeline smoke tests — run with:
 *   node test-requirements.js
 */
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const {
  parseFullRequirements,
  analyzeStoryPrerequisites,
  buildAnalystOutput,
  validateAnalystOutput,
} = require("./lib/prerequisites.cjs");
const { LOGIN_USE_CASE_SAMPLE } = require("./test/fixtures/login-use-case.cjs");

const SAMPLE = LOGIN_USE_CASE_SAMPLE;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log("✓", name);
    passed++;
  } catch (e) {
    console.log("✗", name, "—", e.message);
    failed++;
  }
}

const parsed = parseFullRequirements(SAMPLE);
const story = {
  title: parsed.title,
  description: parsed.description,
  requirements_raw: parsed.requirements_raw,
  acceptance_criteria_list: parsed.acceptance_criteria_list,
  acceptance_criteria_entries: parsed.acceptance_criteria_entries,
  acceptance_criteria_rejected: parsed.acceptance_criteria_rejected,
  requirements_metadata: parsed.requirements_metadata,
  components: parsed.requirements_metadata.components || [],
  labels: [],
};

test("parses title and metadata", () => {
  assert(parsed.title === "Login use case", "title mismatch");
  assert(parsed.requirements_metadata.priority === "High", "priority");
  assert(parsed.requirements_metadata.status === "Draft", "status");
});

test("ACs from Business Rules and Alternative Flow only", () => {
  assert(parsed.acceptance_criteria_list.length === 3, "expected 3 ACs, got " + parsed.acceptance_criteria_list.length);
  assert(parsed.acceptance_criteria_list.includes("User must enter valid email and password"), "missing must AC");
  assert(parsed.acceptance_criteria_list.includes("System rejects invalid credentials"), "missing rejects AC");
  assert(parsed.acceptance_criteria_list.includes("Invalid password shows error"), "missing alt flow AC");
});

test("rejects metadata and UC section headers", () => {
  const texts = parsed.acceptance_criteria_rejected.map((r) => r.text);
  for (const expected of ["UC05", "Priority: High", "Pre-conditions", "Post-conditions", "Basic Flow", "Alternative Flow"]) {
    assert(texts.includes(expected), `missing rejected: ${expected}`);
  }
});

test("basic flow steps are not acceptance criteria", () => {
  const acText = parsed.acceptance_criteria_list.join(" ");
  assert(!/opens login page|enters credentials/i.test(acText), "flow content in ACs");
});

test("free-text paste without AC sections invents zero ACs", () => {
  const free = parseFullRequirements(
    "Users should log in with email and password.\n"
    + "Invalid credentials must show an error.\n"
    + "The system rejects wrong passwords.",
  );
  assert(free.acceptance_criteria_list.length === 0, "expected 0 ACs from free text, got " + free.acceptance_criteria_list.length);
  const out = buildAnalystOutput({
    title: free.title,
    description: free.description,
    requirements_raw: free.requirements_raw,
    acceptance_criteria_list: free.acceptance_criteria_list,
    acceptance_criteria_entries: free.acceptance_criteria_entries,
    acceptance_criteria_rejected: free.acceptance_criteria_rejected,
    components: [],
    labels: [],
  });
  assert(out.testable_conditions.length === 0, "stub must not invent testable_conditions");
  assert(out.ready_for_test_design === false, "not ready without ACs");
});

test("prerequisites exclude section headers", () => {
  const prereq = analyzeStoryPrerequisites(story);
  const labels = prereq.items.map((i) => i.label);
  assert(!labels.some((l) => /Post-conditions|Basic Flow|Alternative Flow|Pre-conditions/i.test(l)), labels.join(", "));
});

test("analyst stub emits analysis_complete and readiness actions", () => {
  const out = buildAnalystOutput(story);
  assert(out.analysis_complete === true, "analysis_complete");
  assert(typeof out.ready_for_test_design === "boolean", "ready_for_test_design");
  assert(Array.isArray(out.analyst_report?.orchestrator_actions), "orchestrator_actions");
  assert(out.analyst_report.orchestrator_actions.length > 0, "non-empty actions");
  assert(out.scratchpad?.rendered, "optional stub scratchpad still rendered");
});

test("structured testable_conditions and prerequisites", () => {
  const out = buildAnalystOutput(story);
  assert(out.testable_conditions.length >= 2, "expected testable conditions");
  assert(out.testable_conditions[0].id && out.testable_conditions[0].source, "structured TC");
  assert(out.testable_conditions[0].delta_or_regression, "delta_or_regression");
  assert(Array.isArray(out.prerequisites_needed.blocking), "blocking array");
  assert(Array.isArray(out.prerequisites_needed.non_blocking), "non_blocking array");
  assert(Array.isArray(out.coverage_gaps), "coverage_gaps array");
});

test("login user gap when no credentials", () => {
  const prereq = analyzeStoryPrerequisites(story);
  const labels = prereq.items.map((i) => i.label);
  assert(labels.some((l) => l === "Login test user"), "expected login gap: " + labels.join(", "));
});

test("validator fails metadata mapped as AC", () => {
  const bad = {
    analyst_reasoning: { ticket_read: "bad", rejected_as_non_ac: [] },
    analysis_complete: true,
    ready_for_test_design: true,
    testable_conditions: [{
      id: "AC-1",
      source: "Business Rules",
      ac_text: "UC05",
      roles: ["user"],
      testable_statement: "verify UC05",
      pass_evidence: "ok",
      fail_evidence: "fail",
    }],
    prerequisites_needed: { blocking: [], non_blocking: [] },
    coverage_gaps: [],
    analyst_report: {
      what_i_did: [],
      why: [],
      orchestrator_actions: [{ action: "PROCEED", target: "writer", blocking: false }],
      confidence: { overall: "high" },
    },
  };
  assert(!validateAnalystOutput(story, bad).passed, "should fail");
});

test("validator fails section header as prerequisite item", () => {
  const good = buildAnalystOutput(story);
  const bad = {
    ...good,
    prerequisites_needed: {
      ...good.prerequisites_needed,
      items: [{ label: "Basic Flow", analyst_note: "bad" }],
    },
  };
  assert(!validateAnalystOutput(story, bad).passed, "should fail section header prereq");
});

test("validator passes complete analyst output", () => {
  const out = buildAnalystOutput(story);
  const result = validateAnalystOutput(story, out);
  assert(result.passed, "should pass: " + result.failures.join("; "));
});

test("JIRA-style title+description uses section-aware analyst output", () => {
  const jiraParsed = parseFullRequirements(`Login use case\n${SAMPLE.split("\n").slice(1).join("\n")}`);
  const jiraStory = {
    title: "Login use case",
    description: jiraParsed.description,
    requirements_raw: jiraParsed.requirements_raw,
    acceptance_criteria_list: jiraParsed.acceptance_criteria_list,
    acceptance_criteria_entries: jiraParsed.acceptance_criteria_entries,
    acceptance_criteria_rejected: jiraParsed.acceptance_criteria_rejected,
    requirements_metadata: jiraParsed.requirements_metadata,
    components: [],
    labels: [],
  };
  const out = buildAnalystOutput(jiraStory);
  assert(out.analysis_complete === true, "analysis_complete");
  // Login sample: invalid-password + valid-email/password are distinct; "rejects invalid
  // credentials" is the same concept as invalid-password → rejected as duplicate.
  assert(out.testable_conditions.length === 2, "expected 2 distinct-concept ACs (duplicate collapsed)");
  assert(out.testable_conditions.some((c) => c.source === "Alternative Flow"), "missing alt flow source");
  assert(
    (out.analyst_reasoning?.rejected_as_non_ac || []).some((r) => /duplicate concept/i.test(r)),
    "expected duplicate-concept rejection",
  );
  assert(out.analyst_reasoning?.rejected_as_non_ac?.length > 0, "missing rejected lines");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
