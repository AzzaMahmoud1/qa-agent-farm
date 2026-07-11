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
const { LOGIN_USE_CASE_SAMPLE } = require("./requirements-sample.cjs");

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

test("prerequisites exclude section headers", () => {
  const prereq = analyzeStoryPrerequisites(story);
  const labels = prereq.items.map((i) => i.label);
  assert(!labels.some((l) => /Post-conditions|Basic Flow|Alternative Flow|Pre-conditions/i.test(l)), labels.join(", "));
});

test("analyst output includes scratchpad steps A–E", () => {
  const out = buildAnalystOutput(story);
  assert(out.scratchpad?.step_a_ambiguity_scan, "missing step A");
  assert(out.scratchpad?.step_b_section_classification, "missing step B");
  assert(out.scratchpad?.step_c_testable_conditions, "missing step C");
  assert(out.scratchpad?.step_d_prerequisites, "missing step D");
  assert(out.scratchpad?.step_e_coverage_gaps, "missing step E");
  assert(out.scratchpad.rendered.includes("SCRATCHPAD STEP A"), "missing rendered scratchpad");
});

test("structured testable_conditions and prerequisites", () => {
  const out = buildAnalystOutput(story);
  assert(out.testable_conditions.length >= 2, "expected testable conditions");
  assert(out.testable_conditions[0].id && out.testable_conditions[0].source, "structured TC");
  assert(Array.isArray(out.prerequisites_needed.blocking), "blocking array");
  assert(Array.isArray(out.prerequisites_needed.non_blocking), "non_blocking array");
  assert(out.coverage_gaps.every((g) => g.category && g.severity), "structured gaps");
  assert(out.related_files[0].path && out.related_files[0].reason, "related_files objects");
});

test("login user gap when no credentials", () => {
  const prereq = analyzeStoryPrerequisites(story);
  const labels = prereq.items.map((i) => i.label);
  assert(labels.some((l) => l === "Login test user"), "expected login gap: " + labels.join(", "));
});

test("validator fails metadata mapped as AC", () => {
  const bad = {
    scratchpad: {
      step_a_ambiguity_scan: "AMBIGUITY SCAN:\n- [CLEAN]",
      step_b_section_classification: "SECTION CLASSIFICATION:\n- ok",
      step_c_testable_conditions: "EXTRACTED",
      step_d_prerequisites: "PREREQUISITES:",
      step_e_coverage_gaps: "COVERAGE GAPS:\nBOUNDARY: NONE",
    },
    analyst_reasoning: { ticket_read: "bad", rejected_as_non_ac: [] },
    related_files: [{ path: "a.ts", reason: "test" }],
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
    coverage_gaps: [{ gap: "x", category: "negative", severity: "non-blocking", suggested_test: "t" }],
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
  assert(out.scratchpad?.rendered?.includes("SCRATCHPAD STEP B"), "missing scratchpad B");
  assert(out.testable_conditions.length === 3, "expected 3 structured ACs from JIRA path");
  assert(out.testable_conditions.some((c) => c.source === "Alternative Flow"), "missing alt flow source");
  assert(out.analyst_reasoning?.rejected_as_non_ac?.length > 0, "missing rejected lines");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
