/**
 * Grounding validation — verify every finding traces to real evidence.
 *
 * Each analysis skill asserts that its findings are supported by a verbatim
 * `evidence_quote` copied from the story. This module checks that claim
 * against the actual story text instead of trusting it: a finding whose quote
 * does not appear verbatim is an unsupported (likely hallucinated) claim and
 * is dropped before anything is passed downstream.
 *
 * Normalization is deliberately conservative — whitespace is collapsed, smart
 * punctuation folded, comparison case-insensitive (models reflow/re-case when
 * copying) — but the WORDS themselves must match. Paraphrase fails on purpose.
 */

/** Quotes shorter than this are too weak to establish grounding. */
export const MIN_QUOTE_CHARS = 12;

const WHITESPACE_RE = /\s+/g;
const PUNCT_FOLD = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-",
  "—": "-", "―": "-", "−": "-",
  " ": " ", "…": "...",
};

/**
 * Collapse whitespace, fold smart punctuation, casefold. Intentionally does
 * NOT stem, drop stopwords, or fuzzy-match — those would let paraphrase pass
 * as a verbatim quote, which is exactly what this exists to catch.
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  if (!text) return "";
  let out = String(text).normalize("NFKC");
  out = Array.from(out).map((ch) => PUNCT_FOLD[ch] ?? ch).join("");
  return out.replace(WHITESPACE_RE, " ").trim().toLowerCase();
}

/**
 * Is `quote` a verbatim span of `evidenceText`?
 * @param {string} quote
 * @param {string} evidenceText — the full story/ticket text
 * @returns {{ ok: boolean, reason: string }}
 */
export function checkQuoteGrounded(quote, evidenceText) {
  const trimmed = String(quote || "").trim();
  if (trimmed.length < MIN_QUOTE_CHARS) {
    return {
      ok: false,
      reason: `evidence_quote too short to establish grounding (${trimmed.length} chars, min ${MIN_QUOTE_CHARS})`,
    };
  }
  if (!normalize(evidenceText).includes(normalize(quote))) {
    return {
      ok: false,
      reason: `evidence_quote does not appear verbatim in the story — paraphrase/invented quotes are not valid grounding (quote: ${JSON.stringify(trimmed.slice(0, 80))})`,
    };
  }
  return { ok: true, reason: "" };
}

/**
 * Drop findings whose `evidence_quote` cannot be verified against the story.
 * Nothing unsupported is ever passed downstream as verified.
 * @param {Array<object>} findings
 * @param {string} evidenceText
 * @param {string} [quoteKey="evidence_quote"]
 * @returns {{ kept: object[], dropped: object[], failures: string[] }}
 */
export function groundFindings(findings, evidenceText, quoteKey = "evidence_quote") {
  const kept = [];
  const dropped = [];
  const failures = [];
  const list = Array.isArray(findings) ? findings : [];
  list.forEach((finding, i) => {
    const { ok, reason } = checkQuoteGrounded(finding?.[quoteKey], evidenceText);
    if (ok) {
      kept.push(finding);
    } else {
      dropped.push(finding);
      failures.push(`findings[${i}]: ${reason}`);
    }
  });
  return { kept, dropped, failures };
}
