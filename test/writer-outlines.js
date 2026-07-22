import assert from "node:assert/strict";
import { buildWriterOutput } from "../agents/writer.js";
import { buildAuthorOutput } from "../agents/author.js";

const analyst = {
  testable_conditions: [
    { id: "AC-1", text: "User can log in with valid credentials" },
    { id: "AC-2", text: "Invalid token must be rejected with clear error" },
  ],
  prerequisites_needed: { blocking: [], non_blocking: [] },
};
const story = { id: "DEMO-1", title: "Login", acceptance_criteria_list: [], test_cases: [] };
const web = { ok: true, url: "https://staging.example.com" };

const writer = buildWriterOutput(story, analyst);
assert.equal(writer.test_outlines.length, 2);
assert.equal(writer.test_outlines[0].status, "draft");
assert.ok(writer.coverage_matrix["AC-1"]?.includes("TO-01"));
assert.equal(writer.test_cases[0].documentation_only, true);

// Analyst v3 schema uses ac_text — Writer must map it into outlines/GWT
const analystV3 = {
  testable_conditions: [{
    id: "AC-1",
    ac_text: "User can reset password with a valid token",
    testable_statement: "System MUST allow password reset when token is valid",
  }],
  prerequisites_needed: { blocking: [], non_blocking: [] },
};
const fromAcText = buildWriterOutput(story, analystV3);
assert.equal(fromAcText.test_outlines.length, 1);
assert.match(fromAcText.test_outlines[0].title, /reset password/i);
assert.match(fromAcText.test_cases[0].when, /reset password/i);

assert.equal(buildAuthorOutput(story, writer, analyst, web).status, "PLAN_READY");
writer.test_outlines[0].status = "approved";
const building = buildAuthorOutput(story, writer, analyst, web);
assert.equal(building.status, "BUILDING");
assert.match(building.blocked_reason, /S2|Playwright/i);

assert.equal(buildWriterOutput(story, { testable_conditions: [] }).blocked, true);
console.log("writer-outlines tests: ok");
