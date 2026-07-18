import assert from "node:assert/strict";
import { buildWriterOutput } from "../agents/writer.js";
import { buildAuthorOutput } from "../agents/author.js";

const analyst = {
  testable_conditions: [
    { id: "AC-1", text: "User can log in with valid Nafath credentials" },
    { id: "AC-2", text: "Invalid token must be rejected with clear error" },
  ],
  prerequisites_needed: { blocking: [], non_blocking: [] },
};
const story = { id: "DEMO-1", title: "Nafath login", acceptance_criteria_list: [], test_cases: [] };
const web = { ok: true, url: "https://staging.example.com" };

const writer = buildWriterOutput(story, analyst);
assert.equal(writer.test_outlines.length, 2);
assert.equal(writer.test_outlines[0].status, "draft");
assert.ok(writer.coverage_matrix["AC-1"]?.includes("TO-01"));
assert.equal(writer.test_cases[0].documentation_only, true);

assert.equal(buildAuthorOutput(story, writer, analyst, web).status, "PLAN_READY");
writer.test_outlines[0].status = "approved";
const building = buildAuthorOutput(story, writer, analyst, web);
assert.equal(building.status, "BUILDING");
assert.match(building.blocked_reason, /S2|Playwright/i);

assert.equal(buildWriterOutput(story, { testable_conditions: [] }).blocked, true);
console.log("writer-outlines tests: ok");
