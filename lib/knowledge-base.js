/**
 * Requirements knowledge base — persists each analyzed ticket's breakdown so
 * future runs can (1) inject prior requirements into the analyst prompt for
 * continuity and (2) search across all stored requirements for cross-ticket
 * reuse.
 *
 * File: <repo>/.farm/requirements-kb.json (gitignored via .farm/).
 *
 * Node-only persistence. fs/path are loaded lazily so this module also loads in
 * the browser (agents/index.js pulls it into the simulator bundle), where it
 * degrades to an in-memory no-op — the durable store is a server feature.
 */
const isNode = typeof process !== "undefined"
  && !!(process.versions && process.versions.node)
  && typeof window === "undefined";

let fs = null;
let path = null;
let DEFAULT_KB_PATH = null;

if (isNode) {
  const { createRequire } = await import("node:module");
  const nodeRequire = createRequire(import.meta.url);
  fs = nodeRequire("fs");
  path = nodeRequire("path");
  const { fileURLToPath } = await import("node:url");
  const dir = path.dirname(fileURLToPath(import.meta.url));
  DEFAULT_KB_PATH = path.join(dir, "..", ".farm", "requirements-kb.json");
}

const EMPTY = () => ({ version: 1, updated_at: null, tickets: {} });

export function knowledgeBasePath(overridePath) {
  if (overridePath) return overridePath;
  if (!isNode) return null;
  return process.env.REQUIREMENTS_KB_PATH || DEFAULT_KB_PATH;
}

export function loadKnowledgeBase(overridePath) {
  const file = knowledgeBasePath(overridePath);
  if (!fs || !file) return EMPTY();
  try {
    if (!fs.existsSync(file)) return EMPTY();
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return EMPTY();
    return {
      version: Number(raw.version) || 1,
      updated_at: raw.updated_at || null,
      tickets: raw.tickets && typeof raw.tickets === "object" ? raw.tickets : {},
    };
  } catch {
    return EMPTY();
  }
}

function saveKnowledgeBase(kb, overridePath) {
  const next = {
    version: 1,
    updated_at: new Date().toISOString(),
    tickets: kb?.tickets && typeof kb.tickets === "object" ? kb.tickets : {},
  };
  const file = knowledgeBasePath(overridePath);
  if (!fs || !file) return next; // browser / no persistence — in-memory only
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** Deterministic non-crypto digest for change detection (djb2-ish). */
function hashOf(value) {
  const s = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return String(h);
}

/** Reduce a raw analyst breakdown to the compact, storable knowledge shape. */
export function summarizeBreakdown(breakdown) {
  const conditions = Array.isArray(breakdown?.testable_conditions) ? breakdown.testable_conditions : [];
  const acceptance_criteria = conditions
    .map((c) => ({
      id: c?.id || null,
      text: String(c?.ac_text || c?.testable_statement || "").trim(),
      source: c?.source || null,
      ...(c?.visual === true ? { visual: true } : {}),
    }))
    .filter((a) => a.text);
  const coverage_gaps = (Array.isArray(breakdown?.coverage_gaps) ? breakdown.coverage_gaps : [])
    .map((g) => (typeof g === "string" ? g : g?.gap))
    .filter(Boolean);
  const prereq = breakdown?.prerequisites_needed || {};
  const blocking_prerequisites = (Array.isArray(prereq.blocking) ? prereq.blocking : [])
    .map((b) => (typeof b === "string" ? b : b?.item || b?.id))
    .filter(Boolean);
  return {
    acceptance_criteria,
    coverage_gaps,
    blocking_prerequisites,
    summary: String(breakdown?.summary || "").trim() || null,
  };
}

/**
 * Record a ticket's analyzed requirements. Keeps a short version history when
 * the content changes so the evolution of a ticket's requirements is visible.
 */
export function recordRequirements({ ticketId, title, breakdown, sources } = {}, overridePath) {
  const id = String(ticketId || "").trim();
  if (!id) return loadKnowledgeBase(overridePath);
  const kb = loadKnowledgeBase(overridePath);
  const digest = summarizeBreakdown(breakdown);
  const hash = hashOf(digest);
  const prev = kb.tickets[id];
  const at = new Date().toISOString();

  const history = Array.isArray(prev?.history) ? [...prev.history] : [];
  if (prev && prev.hash !== hash) {
    history.push({
      at: prev.updated_at,
      hash: prev.hash,
      acceptance_criteria_count: (prev.acceptance_criteria || []).length,
    });
  }

  kb.tickets[id] = {
    id,
    title: title || prev?.title || id,
    hash,
    updated_at: at,
    ...digest,
    sources: sources || prev?.sources || null,
    history: history.slice(-20),
  };
  return saveKnowledgeBase(kb, overridePath);
}

export function getRequirements(ticketId, overridePath) {
  const id = String(ticketId || "").trim();
  if (!id) return null;
  return loadKnowledgeBase(overridePath).tickets[id] || null;
}

/** Diff a fresh breakdown against what is stored — added/removed/kept AC texts. */
export function diffAgainstStored(ticketId, breakdown, overridePath) {
  const prev = getRequirements(ticketId, overridePath);
  const nextAcs = summarizeBreakdown(breakdown).acceptance_criteria.map((a) => a.text);
  if (!prev) return { prior_run: false, added: nextAcs, removed: [], kept: [] };
  const prevAcs = (prev.acceptance_criteria || []).map((a) => a.text);
  const prevSet = new Set(prevAcs);
  const nextSet = new Set(nextAcs);
  return {
    prior_run: true,
    last_updated: prev.updated_at,
    added: nextAcs.filter((t) => !prevSet.has(t)),
    removed: prevAcs.filter((t) => !nextSet.has(t)),
    kept: nextAcs.filter((t) => prevSet.has(t)),
  };
}

/** Keyword search across stored ACs / titles / summaries (cross-ticket reuse). */
export function searchRequirements(query, { excludeId, limit = 10, statePath } = {}) {
  const terms = String(query || "").toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 3);
  if (!terms.length) return [];
  const kb = loadKnowledgeBase(statePath);
  const results = [];
  for (const entry of Object.values(kb.tickets)) {
    if (excludeId && entry.id === excludeId) continue;
    const acMatches = (entry.acceptance_criteria || []).filter((a) => {
      const t = a.text.toLowerCase();
      return terms.some((term) => t.includes(term));
    });
    const title = String(entry.title || "").toLowerCase();
    const summary = String(entry.summary || "").toLowerCase();
    const titleHits = terms.filter((term) => title.includes(term)).length;
    const summaryHits = terms.filter((term) => summary.includes(term)).length;
    const score = acMatches.length * 2 + titleHits + summaryHits;
    if (score > 0) {
      results.push({
        id: entry.id,
        title: entry.title,
        score,
        updated_at: entry.updated_at,
        matched_acs: acMatches.slice(0, 5).map((a) => a.text),
        summary: entry.summary,
      });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Build a compact "prior requirements knowledge" block for the analyst prompt:
 * this ticket's last-known ACs plus related ACs from other tickets. Returns ""
 * when nothing is known so the caller can omit the section.
 */
export function buildPriorKnowledgeBlock(ticketId, queryText, { statePath, maxRelated = 3, maxAcs = 12 } = {}) {
  const id = String(ticketId || "").trim();
  const prior = id ? getRequirements(id, statePath) : null;
  const related = searchRequirements(queryText, { excludeId: id, limit: maxRelated, statePath });
  if (!prior && !related.length) return "";

  const lines = [
    "PRIOR REQUIREMENTS KNOWLEDGE (from earlier analyses — use only for continuity",
    "and to avoid contradicting past decisions; never treat it as ticket evidence,",
    "and re-derive every AC from the current ticket text/attachments):",
  ];
  if (prior) {
    lines.push(`- This ticket (${prior.id}) was analyzed before on ${prior.updated_at} — ${(prior.acceptance_criteria || []).length} AC(s) then:`);
    for (const a of (prior.acceptance_criteria || []).slice(0, maxAcs)) {
      lines.push(`  · ${a.id ? a.id + ": " : ""}${a.text}`);
    }
    if ((prior.blocking_prerequisites || []).length) {
      lines.push(`  · Previously known blocking prerequisites: ${prior.blocking_prerequisites.join("; ")}`);
    }
  }
  if (related.length) {
    lines.push("- Related requirements seen in other tickets (reuse patterns, do not copy blindly):");
    for (const r of related) {
      lines.push(`  · ${r.id} "${r.title}":`);
      for (const text of r.matched_acs.slice(0, 3)) lines.push(`    - ${text}`);
    }
  }
  return lines.join("\n");
}

if (typeof window !== "undefined") {
  window.qaKnowledgeBase = { summarizeBreakdown };
}
