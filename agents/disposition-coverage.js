/**
 * Disposition coverage — no silent drops.
 * Every Business Rules / Alternative / Exception candidate line from the ticket
 * must appear in testable | ambiguous | out_of_scope (unimplemented) | rejected.
 */

function stripListPrefix(line) {
  return String(line || "").replace(/^[\s•\-*\d.]+\s*|^AC-\d+[:.)]\s*/i, "").trim();
}

export function normalizeDispositionLine(s) {
  return stripListPrefix(s)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Candidate lines that require an explicit disposition. */
export function expectedDispositionLines(story) {
  if (!story || typeof story !== "object") return [];
  const entries = story.acceptance_criteria_entries || [];
  if (entries.length) {
    return entries
      .map((e) => stripListPrefix(typeof e === "string" ? e : e?.text))
      .filter((t) => t && t.length >= 3);
  }
  return (story.acceptance_criteria_list || [])
    .map((t) => stripListPrefix(t))
    .filter((t) => t && t.length >= 3);
}

function rejectedLineText(r) {
  if (typeof r === "string") {
    // "line — reason" or "line - reason"
    const cut = r.split(/\s+[—–-]\s+/);
    return stripListPrefix(cut[0] || r);
  }
  return stripListPrefix(r?.text || "");
}

/** Texts the Analyst has dispositioned (any bucket). */
export function collectDispositionTexts(parsed) {
  const texts = [];
  const conditions = parsed?.testable_conditions || [];
  for (const c of conditions) {
    if (c?.ac_text) texts.push(c.ac_text);
  }

  const reasoning = parsed?.analyst_reasoning || {};
  for (const a of reasoning.ambiguous_acs || []) {
    if (a?.source_line) texts.push(a.source_line);
    else if (a?.ac_text) texts.push(a.ac_text);
    else if (a?.ac_id) {
      const c = conditions.find((x) => x && x.id === a.ac_id);
      if (c?.ac_text) texts.push(c.ac_text);
    }
    const q = String(a?.question_for_human || "");
    const m = q.match(/\bfor:\s*(.+)$/i);
    if (m) texts.push(m[1].replace(/\?+\s*$/, "").trim());
  }

  for (const u of reasoning.unimplemented_rules || []) {
    texts.push(typeof u === "string" ? u : u?.text || "");
  }

  for (const r of reasoning.rejected_as_non_ac || []) {
    texts.push(rejectedLineText(r));
  }

  // Legacy path used by some stub payloads
  for (const r of parsed?.prerequisites_needed?.story_analysis?.rejected_as_non_ac || []) {
    texts.push(rejectedLineText(r));
  }

  return texts.map((t) => stripListPrefix(t)).filter((t) => t && t.length >= 3);
}

function isLineCovered(expectedNorm, dispositionNorms) {
  if (!expectedNorm) return true;
  for (const d of dispositionNorms) {
    if (!d) continue;
    if (d === expectedNorm) return true;
    // Allow short verbatim quote inside a longer disposition note
    if (expectedNorm.length >= 12 && d.includes(expectedNorm)) return true;
    if (d.length >= 12 && expectedNorm.includes(d)) return true;
  }
  return false;
}

/**
 * @param {object|null} story
 * @param {object} parsed — Analyst JSON
 * @returns {{ ok: boolean, failures: string[], uncovered: string[], covered_count: number, expected_count: number }}
 */
export function checkDispositionCoverage(story, parsed) {
  const expected = expectedDispositionLines(story);
  if (!expected.length) {
    return { ok: true, failures: [], uncovered: [], covered_count: 0, expected_count: 0 };
  }

  const dispositionNorms = collectDispositionTexts(parsed).map(normalizeDispositionLine);
  const uncovered = [];
  for (const line of expected) {
    const n = normalizeDispositionLine(line);
    if (!isLineCovered(n, dispositionNorms)) uncovered.push(line);
  }

  const failures = [];
  if (uncovered.length) {
    const preview = uncovered.slice(0, 5).map((l) => `"${l.slice(0, 80)}"`).join(", ");
    const more = uncovered.length > 5 ? ` (+${uncovered.length - 5} more)` : "";
    failures.push(
      `DISPOSITION: ${uncovered.length}/${expected.length} source line(s) have no disposition `
      + `(testable | ambiguous | unimplemented | rejected) — ${preview}${more}`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    uncovered,
    covered_count: expected.length - uncovered.length,
    expected_count: expected.length,
  };
}
