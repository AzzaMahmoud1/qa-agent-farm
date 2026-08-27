/** Unit tests for the requirements knowledge base (isolated temp store). */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordRequirements,
  getRequirements,
  diffAgainstStored,
  searchRequirements,
  buildPriorKnowledgeBlock,
  summarizeBreakdown,
} from "../lib/knowledge-base.js";

const dir = mkdtempSync(join(tmpdir(), "qa-kb-"));
const KB = join(dir, "kb.json");

function breakdown(acs, extra = {}) {
  return {
    testable_conditions: acs.map((t, i) => ({ id: `AC-${i + 1}`, ac_text: t, source: "Business Rules" })),
    coverage_gaps: [{ gap: "no negative test", category: "negative" }],
    prerequisites_needed: { blocking: [{ item: "Staging URL", category: "access" }], non_blocking: [] },
    summary: "login rules",
    ...extra,
  };
}

try {
  // summarizeBreakdown compacts conditions
  const digest = summarizeBreakdown(breakdown(["User can log in with valid credentials"]));
  assert.equal(digest.acceptance_criteria.length, 1);
  assert.equal(digest.acceptance_criteria[0].text, "User can log in with valid credentials");
  assert.deepEqual(digest.blocking_prerequisites, ["Staging URL"]);

  // record + recall
  recordRequirements({ ticketId: "PROJ-1", title: "Login", breakdown: breakdown(["User can log in with valid credentials", "Reject invalid passwords"]) }, KB);
  const stored = getRequirements("PROJ-1", KB);
  assert.equal(stored.acceptance_criteria.length, 2);
  assert.equal(stored.title, "Login");
  assert.equal(stored.history.length, 0, "no history on first record");

  // diff before re-record: changed set
  const d = diffAgainstStored("PROJ-1", breakdown(["User can log in with valid credentials", "Lock account after 5 attempts"]), KB);
  assert.equal(d.prior_run, true);
  assert.deepEqual(d.added, ["Lock account after 5 attempts"]);
  assert.deepEqual(d.removed, ["Reject invalid passwords"]);
  assert.deepEqual(d.kept, ["User can log in with valid credentials"]);

  // re-record with changed content pushes history
  recordRequirements({ ticketId: "PROJ-1", title: "Login", breakdown: breakdown(["User can log in with valid credentials", "Lock account after 5 attempts"]) }, KB);
  assert.equal(getRequirements("PROJ-1", KB).history.length, 1, "history grows on change");

  // second ticket for cross-ticket search
  recordRequirements({ ticketId: "PROJ-2", title: "Password reset", breakdown: breakdown(["System must expire the reset token after 15 minutes"]) }, KB);

  const hits = searchRequirements("reset token", { statePath: KB });
  assert.equal(hits[0].id, "PROJ-2", "search finds the reset ticket");
  assert.ok(hits[0].matched_acs.some((t) => /reset token/i.test(t)));
  // exclude + short-term filter
  assert.equal(searchRequirements("to", { statePath: KB }).length, 0, "terms under 3 chars ignored");
  assert.equal(searchRequirements("login", { excludeId: "PROJ-1", statePath: KB }).some((r) => r.id === "PROJ-1"), false);

  // prior-knowledge prompt block: same ticket + related
  const block = buildPriorKnowledgeBlock("PROJ-1", "reset token expiry", { statePath: KB });
  assert.match(block, /PRIOR REQUIREMENTS KNOWLEDGE/);
  assert.match(block, /PROJ-1/);
  assert.match(block, /PROJ-2/, "related ticket surfaced");
  // unknown ticket + no query → empty
  assert.equal(buildPriorKnowledgeBlock("NOPE-9", "", { statePath: KB }), "");

  console.log("knowledge-base tests: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
