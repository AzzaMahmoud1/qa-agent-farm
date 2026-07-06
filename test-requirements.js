#!/usr/bin/env node
/**
 * Requirements pipeline smoke tests — run with:
 *   node test-requirements.js
 */
const {
  parseFullRequirements,
  analyzeStoryPrerequisites,
  validateAnalystOutput,
} = require("./prerequisites.js");

const SAMPLE = `Login use case
UC05
Priority: High
Status: Draft

Pre-conditions
User has registered account

Post-conditions
User is logged in

Basic Flow
1. User opens login page
2. User enters credentials

Alternative Flow
Invalid password shows error

User must enter valid email and password
System rejects invalid credentials`;

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

test("ACs are strong behavioural lines only", () => {
  assert(parsed.acceptance_criteria_list.length === 2, "expected 2 ACs, got " + parsed.acceptance_criteria_list.length);
  assert(parsed.acceptance_criteria_list.includes("User must enter valid email and password"), "missing must AC");
  assert(parsed.acceptance_criteria_list.includes("System rejects invalid credentials"), "missing rejects AC");
});

test("rejects metadata and UC section headers", () => {
  const texts = parsed.acceptance_criteria_rejected.map((r) => r.text);
  for (const expected of ["UC05", "Priority: High", "Pre-conditions", "Post-conditions", "Basic Flow", "Alternative Flow"]) {
    assert(texts.includes(expected), `missing rejected: ${expected}`);
  }
});

test("flow steps are not acceptance criteria", () => {
  const acText = parsed.acceptance_criteria_list.join(" ");
  assert(!/opens login page|enters credentials|registered account|logged in|Invalid password shows/i.test(acText), "flow content in ACs");
});

test("prerequisites exclude section headers", () => {
  const prereq = analyzeStoryPrerequisites(story);
  const labels = prereq.items.map((i) => i.label);
  assert(!labels.some((l) => /Post-conditions|Basic Flow|Alternative Flow|Pre-conditions/i.test(l)), labels.join(", "));
});

test("login user gap when no credentials", () => {
  const prereq = analyzeStoryPrerequisites(story);
  const labels = prereq.items.map((i) => i.label);
  assert(labels.length <= 1, "too many prereq items: " + labels.join(", "));
  if (labels.length) assert(labels[0] === "Login test user", labels[0]);
});

test("validator fails metadata mapped as AC", () => {
  const bad = {
    related_files: ["a.ts"],
    prerequisites_needed: {
      story_analysis: {
        test_actions: [{ ac: "AC-1", ac_text: "UC05", action: "verify: UC05" }],
        rejected_as_non_ac: [],
      },
      items: [],
    },
  };
  assert(!validateAnalystOutput(story, bad).passed, "should fail");
});

test("validator fails section header as prerequisite item", () => {
  const bad = {
    related_files: ["a.ts"],
    prerequisites_needed: {
      story_analysis: {
        test_actions: [{ ac: "AC-1", ac_text: story.acceptance_criteria_list[0], action: "log in" }],
        rejected_as_non_ac: parsed.acceptance_criteria_rejected,
      },
      items: [{ label: "Basic Flow", analyst_note: "bad" }],
    },
  };
  assert(!validateAnalystOutput(story, bad).passed, "should fail section header prereq");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
