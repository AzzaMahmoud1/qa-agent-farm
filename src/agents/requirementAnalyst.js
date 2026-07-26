/**
 * Agent 1 — Requirement Analyst (headless Cursor Agent CLI).
 *
 * Vite/bundler (exact import from the Agent 1 spec):
 *   import ANALYST_PROMPT from '../prompts/agent1_requirement_analyst_v3.md?raw';
 *
 * This Node simulator has no bundler, so the same file is loaded from disk below.
 *
 * Runner: `cursor-agent -p ... --model claude-sonnet-5[effort=…]`.
 * Auth: uses the Cursor CLI login (`cursor-agent login` / CURSOR_API_KEY),
 * NOT ANTHROPIC_API_KEY. Routes through Cursor's endpoints.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { extractFinalJson } from "./utils/extractFinalJson.js";
import { checkAnalystPromptContract } from "../../agents/analyst-contract.js";

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../prompts/agent1_requirement_analyst_v3.md",
);

const ANALYST_PROMPT = readFileSync(PROMPT_PATH, "utf8");

const MAX_BUFFER = 20_000_000;
// Cursor Sonnet 5 with per-attempt effort (overridable via env).
// Cursor model spec supports bracket overrides, e.g. claude-sonnet-5[effort=high].
const ANALYST_MODEL = process.env.ANALYST_MODEL || "claude-sonnet-5";
/**
 * First-attempt default. Kept at `high` until medium is empirically validated
 * (see Part 1 — a retry costs more than the effort saved if first-pass fails).
 * Set ANALYST_EFFORT=medium to try cheaper first attempts; ANALYST_RETRY_EFFORT
 * still defaults to high.
 */
const ANALYST_EFFORT_DEFAULT = "high";
/** Retry default when contract fails. Falls back to ANALYST_EFFORT if set. */
const ANALYST_RETRY_EFFORT_DEFAULT = "high";

/** Resolve the cursor-agent binary: env override → PATH → installed version dir. */
function resolveCursorAgentBin() {
  if (process.env.CURSOR_AGENT_BIN) return process.env.CURSOR_AGENT_BIN;
  const versionsDir = join(
    homedir(),
    "Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/share/cursor-agent/versions",
  );
  try {
    const versions = readdirSync(versionsDir).sort();
    for (let i = versions.length - 1; i >= 0; i--) {
      const bin = join(versionsDir, versions[i], "cursor-agent");
      if (existsSync(bin)) return bin;
    }
  } catch { /* fall through */ }
  return "cursor-agent";
}

const CURSOR_AGENT_BIN = resolveCursorAgentBin();

export function effortForAttempt(attempt) {
  const n = Number(attempt) || 1;
  if (n <= 1) {
    return process.env.ANALYST_EFFORT || ANALYST_EFFORT_DEFAULT;
  }
  return process.env.ANALYST_RETRY_EFFORT
    || process.env.ANALYST_EFFORT
    || ANALYST_RETRY_EFFORT_DEFAULT;
}

export function modelSpecForEffort(effort) {
  const e = String(effort || "").trim();
  return e ? `${ANALYST_MODEL}[effort=${e}]` : ANALYST_MODEL;
}

const REQUIRED_TOP_KEYS = [
  "success",
  "analyst_reasoning",
  "testable_conditions",
  "prerequisites_needed",
  "coverage_gaps",
  "analyst_report",
  "analysis_complete",
  "ready_for_test_design",
  "summary",
];

/**
 * @param {unknown} parsed
 * @throws {Error}
 */
export function validateAnalystOutput(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Analyst output must be a JSON object");
  }

  const missing = REQUIRED_TOP_KEYS.filter((k) => !(k in parsed));
  if (missing.length) {
    throw new Error(`Analyst output missing required keys: ${missing.join(", ")}`);
  }

  const reasoning = parsed.analyst_reasoning;
  if (!reasoning || typeof reasoning !== "object" || Array.isArray(reasoning)) {
    throw new Error("analyst_reasoning must be a non-array object");
  }
  for (const key of ["ambiguous_acs", "unimplemented_rules", "rejected_as_non_ac"]) {
    if (!Array.isArray(reasoning[key])) {
      throw new Error(`analyst_reasoning.${key} must be an array`);
    }
  }

  if (!Array.isArray(parsed.testable_conditions)) {
    throw new Error("testable_conditions must be an array");
  }
  if (!Array.isArray(parsed.coverage_gaps)) {
    throw new Error("coverage_gaps must be an array");
  }
  if (typeof parsed.analysis_complete !== "boolean") {
    throw new Error("analysis_complete must be a boolean");
  }
  if (typeof parsed.ready_for_test_design !== "boolean") {
    throw new Error("ready_for_test_design must be a boolean");
  }
  if (typeof parsed.summary !== "string") {
    throw new Error("summary must be a string");
  }

  const prereq = parsed.prerequisites_needed;
  if (!prereq || typeof prereq !== "object" || Array.isArray(prereq)) {
    throw new Error("prerequisites_needed must be an object");
  }
  if (!Array.isArray(prereq.blocking)) {
    throw new Error("prerequisites_needed.blocking must be an array");
  }
  if (!Array.isArray(prereq.non_blocking)) {
    throw new Error("prerequisites_needed.non_blocking must be an array");
  }

  const report = parsed.analyst_report;
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("analyst_report must be an object");
  }
  for (const key of ["what_i_did", "why", "orchestrator_actions"]) {
    if (!(key in report)) {
      throw new Error(`analyst_report missing required key: ${key}`);
    }
  }
  if (!Array.isArray(report.what_i_did)) {
    throw new Error("analyst_report.what_i_did must be an array");
  }
  if (!Array.isArray(report.why)) {
    throw new Error("analyst_report.why must be an array");
  }
  if (!Array.isArray(report.orchestrator_actions)) {
    throw new Error("analyst_report.orchestrator_actions must be an array");
  }

  const contract = checkAnalystPromptContract(parsed);
  if (!contract.ok) {
    throw new Error(contract.failures.join("; "));
  }

  return true;
}

function buildFullPrompt(ticketText, extra = "") {
  return (
    ANALYST_PROMPT
    + "\n\nAnalyze this ticket:\n\n"
    + String(ticketText ?? "")
    + (extra ? "\n\n" + extra : "")
  );
}

/** Env for the child. Strip Anthropic keys so nothing collides with Cursor auth. */
function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDE_API_KEY;
  return env;
}

/**
 * Pull usage/token fields from a cursor-agent JSON envelope when present.
 * @returns {{ input_tokens: number|null, output_tokens: number|null, cache_read_input_tokens: number|null, source: string }|null}
 */
export function extractUsageFromEnvelope(wrapper) {
  if (!wrapper || typeof wrapper !== "object") return null;

  const pick = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    const input = obj.input_tokens ?? obj.inputTokens ?? obj.prompt_tokens ?? obj.promptTokens;
    const output = obj.output_tokens ?? obj.outputTokens ?? obj.completion_tokens ?? obj.completionTokens;
    const cache = obj.cache_read_input_tokens ?? obj.cacheReadInputTokens
      ?? obj.cache_read_tokens ?? obj.cache_creation_input_tokens;
    if (input == null && output == null && cache == null) return null;
    return {
      input_tokens: input != null ? Number(input) : null,
      output_tokens: output != null ? Number(output) : null,
      cache_read_input_tokens: cache != null ? Number(cache) : null,
      source: "envelope",
    };
  };

  return pick(wrapper.usage)
    || pick(wrapper.token_usage)
    || pick(wrapper.tokens)
    || pick(wrapper)
    || pick(wrapper.result && typeof wrapper.result === "object" ? wrapper.result : null);
}

function logAttemptMetrics({ attempt, effort, promptChars, responseChars, usage }) {
  if (usage && (usage.input_tokens != null || usage.output_tokens != null)) {
    console.error(
      `[analyst] attempt=${attempt} effort=${effort}`
      + ` input_tokens=${usage.input_tokens ?? "n/a"}`
      + ` output_tokens=${usage.output_tokens ?? "n/a"}`
      + ` cache_read_input_tokens=${usage.cache_read_input_tokens ?? "n/a"}`,
    );
  } else {
    console.error(
      `[analyst] attempt=${attempt} effort=${effort}`
      + ` usage=unavailable (char proxy) prompt_chars=${promptChars}`
      + ` response_chars=${responseChars}`,
    );
  }
}

/**
 * Unwrap `cursor-agent -p --output-format json` stdout into model text + usage.
 * Handles single-object envelopes and newline-delimited stream JSON.
 * Falls back to raw stdout if it is not a CLI JSON envelope.
 * @returns {{ text: string, usage: object|null }}
 */
function unwrapClaudeStdout(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) {
    throw new Error("Cursor Agent returned empty stdout");
  }

  const parseWrapper = (obj) => {
    if (wrapperIsError(obj)) {
      const msg = typeof obj.result === "string" ? obj.result
        : (typeof obj.message === "string" ? obj.message : JSON.stringify(obj).slice(0, 500));
      const code = obj.api_error_status || obj.error?.code || "";
      throw new Error(`Cursor Agent CLI error${code ? ` (${code})` : ""}: ${String(msg).trim()}`);
    }
    let text = null;
    if (typeof obj.result === "string") text = obj.result;
    else if (typeof obj.content === "string") text = obj.content;
    else if (typeof obj.text === "string") text = obj.text;
    else if (typeof obj?.message?.content === "string") text = obj.message.content;
    else if (Array.isArray(obj?.message?.content)) {
      text = obj.message.content
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
    }
    if (text === null) return null;
    return { text, usage: extractUsageFromEnvelope(obj) };
  };

  // 1) Whole output is one JSON object
  try {
    const wrapper = JSON.parse(raw);
    if (wrapper && typeof wrapper === "object") {
      const parsed = parseWrapper(wrapper);
      if (parsed !== null) return parsed;
    }
  } catch { /* not a single object — try stream-json below */ }

  // 2) Newline-delimited stream JSON: find the last usable event (prefer one with usage)
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let lastText = null;
  let lastUsage = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && typeof obj === "object") {
        const parsed = parseWrapper(obj);
        if (parsed !== null && String(parsed.text).trim()) {
          if (!lastText) lastText = parsed.text;
          const u = parsed.usage || extractUsageFromEnvelope(obj);
          if (u && !lastUsage) lastUsage = u;
          if (lastText && lastUsage) break;
        } else {
          const u = extractUsageFromEnvelope(obj);
          if (u && !lastUsage) lastUsage = u;
        }
      }
    } catch { /* skip non-JSON line */ }
  }
  if (lastText) return { text: lastText, usage: lastUsage };

  // 3) Plain model text (may still contain ```json fences)
  return { text: raw, usage: null };
}

function wrapperIsError(obj) {
  return obj && typeof obj === "object"
    && (obj.is_error === true || obj.subtype === "error" || obj.type === "error");
}

/**
 * Headless Cursor Agent call.
 * @param {string} fullPrompt
 * @param {string} effort
 * @param {{ attempt?: number }} [meta]
 * @returns {Promise<{ text: string, usage: object|null, effort: string, promptChars: number, responseChars: number }>}
 */
async function callClaudeCode(fullPrompt, effort, meta = {}) {
  let stdout = "";
  let stderr = "";
  const modelSpec = modelSpecForEffort(effort);
  const args = [
    "-p", fullPrompt,
    "--output-format", "json",
    "--model", modelSpec,
    "--force",
  ];
  try {
    const result = await new Promise((resolve, reject) => {
      const child = execFile(
        CURSOR_AGENT_BIN,
        args,
        { maxBuffer: MAX_BUFFER, env: childEnv(), encoding: "utf8" },
        (err, out, errOut) => {
          if (err) {
            err.stdout = out;
            err.stderr = errOut;
            reject(err);
          } else {
            resolve({ stdout: out, stderr: errOut });
          }
        },
      );
      // Close stdin immediately so the CLI does not wait for piped input.
      child.stdin?.end();
    });
    stdout = result.stdout || "";
    stderr = result.stderr || "";
  } catch (err) {
    const detail = [
      err?.message,
      err?.stderr ? String(err.stderr).slice(0, 2000) : "",
      err?.stdout ? String(err.stdout).slice(0, 2000) : "",
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `Cursor Agent CLI failed (is it installed and logged in? run \`cursor-agent login\`). ${detail}`,
    );
  }

  if (stderr && /not logged in|authentication required|unauthorized/i.test(stderr)) {
    throw new Error(`Cursor Agent not authenticated — run \`cursor-agent login\`. ${stderr.slice(0, 300)}`);
  }

  const { text, usage } = unwrapClaudeStdout(stdout);
  const promptChars = String(fullPrompt).length;
  const responseChars = String(text).length;
  logAttemptMetrics({
    attempt: meta.attempt || 1,
    effort,
    promptChars,
    responseChars,
    usage,
  });
  return { text, usage, effort, promptChars, responseChars };
}

/**
 * @param {string} fullText
 * @returns {{ scratchpad: string, parsed: object, fullText: string }}
 */
function processFullText(fullText) {
  let scratchpad;
  let parsed;
  try {
    ({ scratchpad, parsed } = extractFinalJson(fullText));
  } catch (extractErr) {
    const err = extractErr instanceof Error ? extractErr : new Error(String(extractErr));
    err.extractFailed = true;
    err.fullText = fullText;
    throw err;
  }
  try {
    validateAnalystOutput(parsed);
  } catch (valErr) {
    const err = valErr instanceof Error ? valErr : new Error(String(valErr));
    err.parsed = parsed;
    err.scratchpad = scratchpad;
    err.fullText = fullText;
    throw err;
  }
  return { scratchpad, parsed, fullText };
}

/**
 * Build retry suffix: failures + compact previous JSON (or truncated raw text).
 * Exported for unit tests.
 */
export function buildRetryExtra(error, fullText) {
  const failures = String(error?.message || "validation failed");
  let previousBlock;
  if (error?.parsed && typeof error.parsed === "object") {
    previousBlock = JSON.stringify(error.parsed);
  } else {
    previousBlock = String(fullText || error?.fullText || "").slice(-2000);
  }
  return [
    "Previous output failed validation. Failures:",
    failures,
    "",
    "Previous JSON (or truncated raw text if JSON was missing):",
    previousBlock,
    "",
    "Return the corrected final ```json block only. No scratchpad. Keep full analysis quality — fix the failures above.",
  ].join("\n");
}

/**
 * Run Requirement Analyst against a ticket via headless Cursor Agent.
 * On extract/validate failure, retries the CLI call exactly once with corrective context.
 *
 * @param {string} ticketText
 * @returns {Promise<{ scratchpad: string, parsed: object, attempts?: object[] } | { success: false, error: string, raw: string, attempts?: object[] }>}
 */
export async function runRequirementAnalyst(ticketText) {
  const attempts = [];
  const basePrompt = buildFullPrompt(ticketText);
  const effort1 = effortForAttempt(1);
  const call1 = await callClaudeCode(basePrompt, effort1, { attempt: 1 });
  attempts.push({
    attempt: 1,
    effort: call1.effort,
    usage: call1.usage,
    prompt_chars: call1.promptChars,
    response_chars: call1.responseChars,
  });
  let fullText = call1.text;

  try {
    const ok = processFullText(fullText);
    return { ...ok, attempts };
  } catch (firstErr) {
    const error = firstErr instanceof Error ? firstErr : new Error(String(firstErr));
    try {
      const retryPrompt = buildFullPrompt(ticketText, buildRetryExtra(error, fullText));
      const effort2 = effortForAttempt(2);
      const call2 = await callClaudeCode(retryPrompt, effort2, { attempt: 2 });
      attempts.push({
        attempt: 2,
        effort: call2.effort,
        usage: call2.usage,
        prompt_chars: call2.promptChars,
        response_chars: call2.responseChars,
      });
      fullText = call2.text;
      const ok = processFullText(fullText);
      return { ...ok, attempts };
    } catch (retryErr) {
      const finalErr = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
      return {
        success: false,
        error: finalErr.message,
        raw: fullText || "",
        attempts,
      };
    }
  }
}

export { ANALYST_PROMPT, extractFinalJson };
