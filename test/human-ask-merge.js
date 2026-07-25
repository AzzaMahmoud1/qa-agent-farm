/** Merge ASK_HUMAN + prerequisite items. Run: node test/human-ask-merge.js */
import assert from "node:assert/strict";
import { mergeHumanAskFields } from "../lib/human-ask-merge.js";

{
  const merged = mergeHumanAskFields({
    actions: [{
      action: "ASK_HUMAN",
      detail: "Provide Login test user for design",
      prereq_id: "login_user",
      requires_value: true,
      provided_value: "",
    }],
    prereqItems: [{
      id: "login_user",
      label: "Login test user",
      analyst_note: "Acceptance criteria require login…",
      required: true,
    }],
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sources.prereq_id, "login_user");
  assert.equal(merged[0].sources.action_idx, 0);
}

{
  // Fallback: label appears in detail when prereq_id absent
  const merged = mergeHumanAskFields({
    actions: [{
      action: "ASK_HUMAN",
      detail: "Provide Login test user (account/credentials) for test design — reason",
      requires_value: true,
    }],
    prereqItems: [{ id: "login_user", label: "Login test user", required: true }],
  });
  assert.equal(merged.length, 1);
}

{
  const merged = mergeHumanAskFields({
    actions: [{ action: "ASK_HUMAN", detail: "Provide billing API curl", requires_value: true }],
    prereqItems: [{ id: "login_user", label: "Login test user", required: true }],
  });
  assert.equal(merged.length, 2);
}

{
  // Credentials ask must not absorb a webpage_url item via loose label match
  const detail = "Provide the username and password of a working test account (Login test user)";
  const merged = mergeHumanAskFields({
    actions: [{ action: "ASK_HUMAN", detail, requires_value: true }],
    prereqItems: [
      { id: "env", label: "login page", input_type: "webpage_url", required: true },
      { id: "login_user", label: "Login test user", required: true },
    ],
  });
  const login = merged.find((f) => f.sources.prereq_id === "login_user" || /Login test user/i.test(f.label));
  assert.ok(login);
  assert.notEqual(login.input_type, "webpage_url");
}

console.log("human-ask-merge tests: ok");
