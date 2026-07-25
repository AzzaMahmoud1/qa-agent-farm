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

console.log("human-ask-merge tests: ok");
