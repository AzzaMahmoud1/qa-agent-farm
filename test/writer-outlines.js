import assert from "node:assert/strict";
import {
  buildWriterOutput,
  buildWriterTestCases,
  buildWhenClause,
  buildGivenClause,
  verifyThatTitle,
  suggestTestFile,
  inferTcType,
  shortTestTitle,
} from "../agents/writer.js";
import { buildAuthorOutput } from "../agents/author.js";

assert.equal(
  inferTcType("Invalid password must be rejected with a clear error"),
  "negative",
);
assert.equal(
  inferTcType("The change shall not require deployment"),
  "happy_path",
);
assert.equal(
  inferTcType("Seha shall not allow guest access to clinical records"),
  "negative",
);

const analyst = {
  testable_conditions: [
    {
      id: "AC-1",
      ac_text: "User can log in with valid credentials on the login page",
      roles: ["user"],
      testable_statement: "System MUST authenticate the user when valid credentials are submitted for user",
      pass_evidence: "User reaches an authenticated session",
      fail_evidence: "Valid credentials rejected or session missing",
      source: "Business Rules",
    },
    {
      id: "AC-2",
      ac_text: "Invalid token must be rejected with clear error on the login page",
      roles: ["user"],
      testable_statement: "System MUST reject the token when an invalid token is submitted for user",
      pass_evidence: "Clear rejection message is shown",
      fail_evidence: "Invalid token is accepted",
      source: "Exception Flow",
    },
  ],
  prerequisites_needed: { blocking: [], non_blocking: [] },
};
const story = {
  id: "DEMO-1",
  title: "Login",
  acceptance_criteria_list: [
    "User can log in with valid credentials on the login page",
    "Invalid token must be rejected with clear error on the login page",
  ],
  test_cases: [],
  from_requirements: true,
};
const web = { ok: true, url: "https://staging.example.com" };

const writer = buildWriterOutput(story, analyst);
assert.equal(writer.test_outlines.length, 2);
assert.equal(writer.test_outlines[0].status, "draft");
assert.ok(writer.coverage_matrix["AC-1"]?.includes("TO-01"));
assert.equal(writer.test_cases[0].documentation_only, true);
assert.equal(writer.test_cases[0].evidence_citation, analyst.testable_conditions[0].ac_text);
assert.equal(writer.ac_verdicts["AC-1"].verdict, "written");
assert.equal(writer.ac_verdicts["AC-2"].verdict, "written");

assert.match(writer.test_cases[0].title, /^Verify that /i);
assert.equal(writer.test_cases[0].ac_text, analyst.testable_conditions[0].ac_text);
assert.equal(
  verifyThatTitle("Seha displays only Nafath as the login method"),
  "Verify that Seha displays only Nafath as the login method",
);
assert.match(shortTestTitle("AC-2", "User can reset password"), /^Verify that /i);

// Classic GWT
assert.match(writer.test_cases[0].given, /^A user is /i);
assert.doesNotMatch(writer.test_cases[0].given, /Preconditions:|Requirements|loaded from/i);
assert.equal(writer.test_cases[0].source_ref, "Requirements DEMO-1 loaded from pasted description");

assert.match(writer.test_cases[0].when, /valid credentials are submitted/i);
assert.doesNotMatch(writer.test_cases[0].when, /Step 1\.|Scenario exercises/i);

assert.equal(writer.test_cases[0].then, "User reaches an authenticated session");
assert.equal(writer.test_cases[0].expected_evidence, "User reaches an authenticated session");
for (const tc of writer.test_cases) {
  const blob = JSON.stringify(tc);
  assert.doesNotMatch(blob, /Expected behavior passes per AC/);
  assert.doesNotMatch(blob, /HTTP 200 \/ success UI/);
  assert.equal(tc.preconditions, undefined);
  assert.equal(tc.steps, undefined);
  assert.equal(tc.expected_results, undefined);
}

assert.equal(writer.test_cases[1].then, "Clear rejection message is shown");
assert.match(writer.test_outlines[0].tasks[0].action, /valid credentials are submitted/i);
assert.equal(writer.test_outlines[0].tasks[0].validation, "User reaches an authenticated session");
assert.match(writer.test_outlines[0].title, /^Verify that /i);
assert.match(writer.test_cases[0].suggested_file || "", /^tests\/e2e\//);

const analystV3 = {
  testable_conditions: [{
    id: "AC-1",
    ac_text: "User can reset password with a valid token",
    testable_statement: "System MUST allow password reset when token is valid for user",
    roles: ["user"],
    pass_evidence: "Password reset completes and user can sign in with the new password",
    fail_evidence: "Reset succeeds with an invalid or expired token",
    source: "Business Rules",
  }],
  prerequisites_needed: { blocking: [], non_blocking: [] },
};
const fromAcText = buildWriterOutput(story, analystV3);
assert.equal(fromAcText.test_outlines.length, 1);
assert.match(fromAcText.test_outlines[0].title, /^Verify that /i);
assert.match(fromAcText.test_cases[0].when, /token is valid/i);
assert.equal(
  fromAcText.test_cases[0].then,
  "Password reset completes and user can sign in with the new password",
);

assert.match(
  buildWhenClause({
    testable_statement: "System MUST display only Nafath for user",
    ac_text: "Seha shall display only Nafath as log in method",
  }),
  /Display only Nafath/i,
);

assert.match(buildGivenClause(["admin"], "Admin opens the dashboard"), /An admin is /i);
assert.equal(
  buildGivenClause([], "Anything"),
  "The actor is in a valid starting state for the scenario",
);

{
  const apiStory = {
    id: "API-9",
    title: "Refund API",
    acceptance_criteria_list: ["POST /api/refunds returns 201 for a valid payment"],
  };
  const apiAnalyst = {
    testable_conditions: [{
      id: "AC-1",
      ac_text: "POST /api/refunds returns 201 for a valid payment",
      roles: ["system"],
      testable_statement: "System MUST create a refund when POST /api/refunds is called for system",
      pass_evidence: "Response status 201 with refund id",
      fail_evidence: "Refund created without a valid payment",
    }],
  };
  assert.equal(suggestTestFile(apiStory, apiAnalyst), "tests/api/api-9.spec.ts");

  const bare = {
    testable_conditions: [{
      id: "AC-1",
      ac_text: "Balance must equal sum of ledger entries",
      roles: ["accountant"],
      testable_statement: "System MUST keep balance consistent when ledger is posted for accountant",
      pass_evidence: "Balance equals ledger sum",
      fail_evidence: "Balance diverges from ledger",
    }],
  };
  assert.equal(suggestTestFile({ id: "LEDGER-1", acceptance_criteria_list: [] }, bare), undefined);
}

{
  const thin = buildWriterOutput(story, {
    testable_conditions: [{
      id: "AC-1",
      ac_text: "Seha shall display only Nafath as log in method",
      roles: ["user"],
      testable_statement: "System MUST display only Nafath when user opens login for user",
      source: "Business Rules",
    }],
  });
  assert.equal(thin.test_cases[0].needs_detail, true);
  assert.equal(thin.test_cases[0].expected_evidence, undefined);
  assert.doesNotMatch(thin.test_cases[0].then, /Expected behavior passes per AC/i);
  assert.match(thin.test_cases[0].title, /^Verify that /i);
}

{
  const cases = buildWriterTestCases(story, {
    testable_conditions: [
      {
        id: "AC-1",
        ac_text: "User can log in with valid credentials on the login page",
        roles: ["user"],
        testable_statement: "System MUST authenticate the user when valid credentials are submitted for user",
        pass_evidence: "User reaches an authenticated session",
        fail_evidence: "Valid credentials rejected or session missing",
      },
      {
        id: "AC-2",
        ac_text: "Invalid credentials must be rejected on the login page",
        roles: ["user"],
        testable_statement: "System MUST reject credentials when invalid password is submitted for user",
        pass_evidence: "Error message is shown",
        fail_evidence: "Invalid credentials are accepted",
      },
      {
        id: "AC-3",
        ac_text: "The change shall not require deployment",
        roles: ["operator"],
        testable_statement: "System MUST apply the change when configuration is updated for operator",
        pass_evidence: "Setting takes effect without a deployment",
        fail_evidence: "Change requires a deployment to become active",
      },
    ],
  });
  assert.equal(cases[0].type, "happy_path");
  assert.equal(cases[1].type, "negative");
  assert.equal(cases[2].type, "happy_path");
  assert.match(cases[0].given, /user/i);
  assert.match(cases[0].when, /valid credentials are submitted/i);
  assert.equal(cases[0].then, "User reaches an authenticated session");
  assert.equal(cases[2].ac_text, "The change shall not require deployment");
  assert.match(cases[2].title, /^Verify that /i);
  assert.ok(cases[0].priority);
  for (const tc of cases) {
    assert.doesNotMatch(JSON.stringify(tc), /Expected behavior passes per AC|HTTP 200 \/ success UI/);
  }
}

assert.equal(buildAuthorOutput(story, writer, analyst, web).status, "PLAN_READY");
writer.test_outlines[0].status = "approved";
const building = buildAuthorOutput(story, writer, analyst, web);
assert.equal(building.status, "BUILDING");
assert.match(building.blocked_reason, /S2|Playwright/i);

assert.equal(buildWriterOutput(story, { testable_conditions: [] }).blocked, true);
console.log("writer-outlines tests: ok");
