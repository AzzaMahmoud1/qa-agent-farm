/**
 * Simulator run persistence: what is saved, what never is (secrets,
 * screenshots), versioning, size cap, and outline-approval restore.
 * Run: node test/run-persistence.js
 */
import assert from "node:assert/strict";
import {
  saveRun, loadRun, clearRun, buildRunSnapshot, parseRunSnapshot, applyOutlineStatuses, RUN_SNAPSHOT_KEY,
} from "../js/run-persistence.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const story = {
  id: "AUTH-101",
  title: "Lockout",
  live_analyst_output: { testable_conditions: [{ id: "AC1" }] },
  live_writer_output: { runner: "live", test_cases: [{ id: "TC-01" }] },
  live_author_output: { status: "REVIEW", steps: [{ kind: "assert", ok: true, evidence: { url: "https://x", screenshot: "AAAA".repeat(1000) } }] },
  attachments: [{ filename: "m.png", base64: "BBBB".repeat(1000) }],
};
const state = {
  story,
  runOptions: { fast: true },
  inputSource: "requirements",
  idx: 7,
  writerOutlines: [{ id: "TO-01", status: "approved" }, { id: "TO-02", status: "draft" }],
  humanApiInput: { ok: true, method: "POST", url: "https://api.x/login", headers: { Authorization: "Bearer SECRET" }, curl: "curl -H 'Authorization: Bearer SECRET'", auth: "SECRET" },
  humanWebpageInput: { ok: true, url: "https://app.x/login", title: "Login" },
};

{
  const storage = memoryStorage();
  assert.equal(saveRun(storage, state), true);
  const raw = storage.getItem(RUN_SNAPSHOT_KEY);
  assert.ok(!raw.includes("SECRET"), "API secrets are never persisted");
  assert.ok(!raw.includes("AAAA"), "screenshots are not persisted");
  assert.ok(!raw.includes("BBBB"), "attachment bytes are not persisted");

  const snap = loadRun(storage);
  assert.equal(snap.story.id, "AUTH-101");
  assert.equal(snap.step_index, 7);
  assert.equal(snap.input_source, "requirements");
  assert.equal(snap.story.live_writer_output.runner, "live", "live results survive a reload");
  assert.deepEqual(snap.outline_statuses, { "TO-01": "approved", "TO-02": "draft" });
  assert.deepEqual(snap.human_web, { ok: true, url: "https://app.x/login", title: "Login" });

  const writer = { test_outlines: [{ id: "TO-01", status: "draft" }, { id: "TO-02", status: "draft" }] };
  applyOutlineStatuses(writer, snap.outline_statuses);
  assert.equal(writer.test_outlines[0].status, "approved", "approvals restored");

  clearRun(storage);
  assert.equal(loadRun(storage), null);
}

{
  assert.equal(buildRunSnapshot({ story: {} }), null, "no story id → nothing to save");
  assert.equal(parseRunSnapshot("{not json"), null);
  assert.equal(parseRunSnapshot(JSON.stringify({ version: 999, story: { id: "X" } })), null, "unknown version ignored");

  const huge = { ...state, story: { id: "BIG", blob: "x".repeat(5_000_000) } };
  assert.equal(saveRun(memoryStorage(), huge), false, "oversized run is skipped, not truncated");

  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); }, removeItem() {} };
  assert.equal(saveRun(throwing, state), false, "storage errors never break the simulator");
  assert.equal(loadRun(throwing), null);
}

console.log("run-persistence tests: ok");
