/**
 * Agent 1 — Requirement Analyst (headless Cursor Agent CLI).
 *
 * Vite/bundler (exact import from the Agent 1 spec):
 *   import ANALYST_PROMPT from '../prompts/agent1_requirement_analyst_v3.md?raw';
 *
 * This Node simulator has no bundler, so the same file is loaded from disk below.
 *
 * Runner: `cursor-agent -p ... --model claude-sonnet-5[effort=high]`.
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
// Cursor Sonnet 5 with high reasoning effort (overridable via env).
// Cursor model spec supports bracket overrides, e.g. claude-sonnet-5[effort=high].
const ANALYST_MODEL = process.env.ANALYST_MODEL || "claude-sonnet-5";
const ANALYST_EFFORT = process.env.ANALYST_EFFORT || "high";

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
// Build the parameterized model spec: claude-sonnet-5[effort=high]
const MODEL_SPEC = ANALYST_EFFORT ? `${ANALYST_MODEL}[effort=${ANALYST_EFFORT}]` : ANALYST_MODEL;

const REQUIRED_TOP_KEYS = [
  "success",
  "testable_conditions",
  "prerequisites_needed",
  "coverage_gaps",
  "analyst_report",
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

  if (!Array.isArray(parsed.testable_conditions)) {
    throw new Error("testable_conditions must be an array");
  }
  if (!Array.isArray(parsed.coverage_gaps)) {
    throw new Error("coverage_gaps must be an array");
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
 * Unwrap `cursor-agent -p --output-format json` stdout into the model text.
 * Handles single-object envelopes and newline-delimited stream JSON.
 * Falls back to raw stdout if it is not a CLI JSON envelope.
 */
function unwrapClaudeStdout(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) {
    throw new Error("Cursor Agent returned empty stdout");
  }

  const parseWrapper = (text) => {
    if (wrapperIsError(text)) {
      const msg = typeof text.result === "string" ? text.result
        : (typeof text.message === "string" ? text.message : JSON.stringify(text).slice(0, 500));
      const code = text.api_error_status || text.error?.code || "";
      throw new Error(`Cursor Agent CLI error${code ? ` (${code})` : ""}: ${String(msg).trim()}`);
    }
    if (typeof text.result === "string") return text.result;
    if (typeof text.content === "string") return text.content;
    if (typeof text.text === "string") return text.text;
    if (typeof text?.message?.content === "string") return text.message.content;
    if (Array.isArray(text?.message?.content)) {
      return text.message.content
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("");
    }
    return null;
  };

  // 1) Whole output is one JSON object
  try {
    const wrapper = JSON.parse(raw);
    if (wrapper && typeof wrapper === "object") {
      const text = parseWrapper(wrapper);
      if (text !== null) return text;
    }
  } catch { /* not a single object — try stream-json below */ }

  // 2) Newline-delimited stream JSON: find the last "result" event
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && typeof obj === "object") {
        const text = parseWrapper(obj);
        if (text !== null && String(text).trim()) return text;
      }
    } catch { /* skip non-JSON line */ }
  }

  // 3) Plain model text (may still contain ```json fences)
  return raw;
}

function wrapperIsError(obj) {
  return obj && typeof obj === "object"
    && (obj.is_error === true || obj.subtype === "error" || obj.type === "error");
}

/**
 * Headless Cursor Agent call.
 * @param {string} fullPrompt
 * @returns {Promise<string>} model text (scratchpad + final JSON fences)
 */
async function callClaudeCode(fullPrompt) {
  let stdout = "";
  let stderr = "";
  const args = [
    "-p", fullPrompt,
    "--output-format", "json",
    "--model", MODEL_SPEC,
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

  return unwrapClaudeStdout(stdout);
}

function processFullText(fullText) {
  const { scratchpad, parsed } = extractFinalJson(fullText);
  validateAnalystOutput(parsed);
  return { scratchpad, parsed, fullText };
}

/**
 * Run Requirement Analyst against a ticket via headless Cursor Agent.
 * On extract/validate failure, retries the CLI call exactly once with corrective context.
 *
 * @param {string} ticketText
 * @returns {Promise<{ scratchpad: string, parsed: object } | { success: false, error: string, raw: string }>}
 */
export async function runRequirementAnalyst(ticketText) {
  const basePrompt = buildFullPrompt(ticketText);
  let fullText = await callClaudeCode(basePrompt);

  try {
    return processFullText(fullText);
  } catch (firstErr) {
    const error = firstErr instanceof Error ? firstErr : new Error(String(firstErr));
    try {
      const retryPrompt = buildFullPrompt(
        ticketText,
        "Your previous output failed validation: "
          + error.message
          + ". Re-run ALL activities per your Retry Rules and output the complete scratchpad and final JSON again.\n\n"
          + "Previous output:\n"
          + fullText,
      );
      fullText = await callClaudeCode(retryPrompt);
      return processFullText(fullText);
    } catch (retryErr) {
      const finalErr = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
      return {
        success: false,
        error: finalErr.message,
        raw: fullText || "",
      };
    }
  }
}

export { ANALYST_PROMPT, extractFinalJson };
