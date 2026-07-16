/**
 * Reviewer rechecks human answers against Analyst asks.
 * Run: node test/human-input-recheck.js
 */
import assert from "node:assert/strict";
import { reviewHumanInputAgainstAnalyst } from "../agents/reviewer.js";

const analyst = {
  testable_conditions: [{ id: "AC-1", ac_text: "Admin can view subs" }],
  prerequisites_needed: {
    blocking: [
      {
        item: "Target environment URL for Organization details",
        category: "access",
        satisfied_by_ticket: false,
        must_be_provided_by: "human",
      },
      {
        item: "Username + password for System Admin",
        category: "access",
        satisfied_by_ticket: false,
        must_be_provided_by: "human",
      },
    ],
    non_blocking: [],
  },
};

{
  const rejected = reviewHumanInputAgainstAnalyst(analyst, {
    actions: [
      {
        action: "ASK_HUMAN",
        target: "human",
        detail: "provide target environment URL",
        provided_value: "todo",
        resolved: true,
      },
    ],
    prereqItems: [
      { id: "env-url", label: "Target environment URL", input_type: "webpage_url" },
    ],
    userPrerequisites: {},
    api: { ok: false },
    webpage: { ok: false, url: "" },
  });
  assert.equal(rejected.verdict, "rejected");
  assert.equal(rejected.passed, false);
  assert.ok(rejected.failures.length >= 1);
  assert.ok(rejected.failures.some((f) => /url|placeholder|empty/i.test(f.blame || f.provided)));
}

{
  const accepted = reviewHumanInputAgainstAnalyst(analyst, {
    actions: [
      {
        action: "ASK_HUMAN",
        target: "human",
        detail: "provide target environment URL",
        provided_value: "https://staging.example.com/orgs/1",
        resolved: true,
      },
      {
        action: "ASK_HUMAN",
        target: "human",
        detail: "provide System Admin username and password",
        provided_value: "admin@example.com / S3cret!",
        resolved: true,
      },
    ],
    prereqItems: [
      { id: "env-url", label: "Target environment URL", input_type: "webpage_url" },
    ],
    userPrerequisites: {},
    api: { ok: false },
    webpage: { ok: true, url: "https://staging.example.com/orgs/1" },
  });
  assert.equal(accepted.verdict, "accepted");
  assert.equal(accepted.passed, true);
  assert.equal(accepted.failures.length, 0);
}

{
  const checkboxOnly = reviewHumanInputAgainstAnalyst(analyst, {
    actions: [
      {
        action: "ASK_HUMAN",
        target: "human",
        detail: "provide Billing API base URL + auth token",
        provided_value: "",
        resolved: true,
      },
    ],
    prereqItems: [],
    userPrerequisites: {},
    api: { ok: false },
    webpage: { ok: false },
  });
  assert.equal(checkboxOnly.verdict, "rejected");
  assert.ok(checkboxOnly.failures.some((f) => /No value|checked, no value/i.test(`${f.blame} ${f.provided}`)));
}

console.log("human-input-recheck tests: ok");
