/**
 * Simulator run persistence — save the current run to browser storage and
 * restore it after a reload, so expensive live Analyst / Writer / Author
 * results and outline approvals are not lost. Pure and storage-injected so it
 * runs under Node tests too.
 *
 * Not persisted: screenshots and attachment bytes (too large), and API /
 * credential secrets (the human re-enters them; they never touch storage).
 */

export const RUN_SNAPSHOT_KEY = "qa-farm-run-v1";
export const RUN_SNAPSHOT_VERSION = 1;
const MAX_BYTES = 4_000_000;

/** Deep copy without screenshots / base64 blobs. */
function stripHeavy(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, v) => {
    if (key === "screenshot" || key === "base64") return undefined;
    return v;
  }));
}

/** Keep the request shape but never the secrets in it. */
function safeApiInput(api) {
  if (!api?.ok) return null;
  return { method: api.method, base_url: api.base_url, endpoint: api.endpoint, url: api.url };
}

function safeWebInput(web) {
  if (!web?.ok) return null;
  return { ok: true, url: web.url, path: web.path, origin: web.origin, title: web.title };
}

export function buildRunSnapshot(state) {
  if (!state?.story?.id) return null;
  const outlineStatuses = Object.fromEntries(
    (state.writerOutlines || []).map((o) => [o.id, o.status]),
  );
  return {
    version: RUN_SNAPSHOT_VERSION,
    saved_at: new Date().toISOString(),
    story: stripHeavy(state.story),
    run_options: stripHeavy(state.runOptions || {}),
    input_source: state.inputSource || "jira",
    step_index: Number.isInteger(state.idx) ? state.idx : -1,
    outline_statuses: outlineStatuses,
    human_api: safeApiInput(state.humanApiInput),
    human_web: safeWebInput(state.humanWebpageInput),
  };
}

export function serializeRunSnapshot(snapshot) {
  if (!snapshot) return null;
  const text = JSON.stringify(snapshot);
  return text.length <= MAX_BYTES ? text : null;
}

export function parseRunSnapshot(text) {
  try {
    const snap = JSON.parse(text);
    if (snap?.version !== RUN_SNAPSHOT_VERSION || !snap.story?.id) return null;
    return snap;
  } catch {
    return null;
  }
}

export function saveRun(storage, state) {
  try {
    const text = serializeRunSnapshot(buildRunSnapshot(state));
    if (!text) return false;
    storage.setItem(RUN_SNAPSHOT_KEY, text);
    return true;
  } catch {
    return false; // quota exceeded / storage blocked — persistence is best-effort
  }
}

export function loadRun(storage) {
  try {
    const text = storage.getItem(RUN_SNAPSHOT_KEY);
    return text ? parseRunSnapshot(text) : null;
  } catch {
    return null;
  }
}

export function clearRun(storage) {
  try { storage.removeItem(RUN_SNAPSHOT_KEY); } catch { /* ignore */ }
}

/** Re-apply saved outline approvals onto a freshly built Writer output. */
export function applyOutlineStatuses(writerOutput, statuses) {
  for (const o of writerOutput?.test_outlines || []) {
    if (statuses?.[o.id]) o.status = statuses[o.id];
  }
  return writerOutput;
}
