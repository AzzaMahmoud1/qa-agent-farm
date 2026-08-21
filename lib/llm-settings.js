/**
 * LLM provider settings — persisted locally (.data/llm-settings.json, gitignored).
 * Lets the Settings UI pick a runner + API key without editing .env or restarting
 * the server. Falls back to env vars when no settings file exists, so existing
 * env-var-based setups keep working unchanged.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = join(ROOT, ".data", "llm-settings.json");

export const KNOWN_RUNNERS = [
  "cursor_agent_cli",
  "anthropic_api",
  "openai_api",
  "openrouter_api",
  "custom_openai_compatible",
];

const DEFAULT_MODELS = {
  anthropic_api: "claude-sonnet-5",
  openai_api: "gpt-5",
  openrouter_api: "anthropic/claude-sonnet-5",
  custom_openai_compatible: "",
};

function emptyProviders() {
  return {
    cursor_agent_cli: { model: "claude-sonnet-5", effort: "high" },
    anthropic_api: { apiKey: "", model: DEFAULT_MODELS.anthropic_api },
    openai_api: { apiKey: "", model: DEFAULT_MODELS.openai_api },
    openrouter_api: { apiKey: "", model: DEFAULT_MODELS.openrouter_api },
    custom_openai_compatible: { apiKey: "", baseUrl: "", model: "" },
  };
}

function readRaw() {
  try {
    const text = readFileSync(SETTINGS_PATH, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @returns {{ runner: string, providers: object }} */
export function loadSettings() {
  const raw = readRaw();
  const providers = { ...emptyProviders(), ...(raw?.providers || {}) };
  for (const key of Object.keys(emptyProviders())) {
    providers[key] = { ...emptyProviders()[key], ...(providers[key] || {}) };
  }
  return {
    runner: KNOWN_RUNNERS.includes(raw?.runner) ? raw.runner : "cursor_agent_cli",
    providers,
  };
}

/** Shallow-merges `partial` into the persisted settings and writes to disk. */
export function saveSettings(partial) {
  const current = loadSettings();
  const next = {
    runner: KNOWN_RUNNERS.includes(partial?.runner) ? partial.runner : current.runner,
    providers: { ...current.providers },
  };
  for (const [key, value] of Object.entries(partial?.providers || {})) {
    if (!Object.prototype.hasOwnProperty.call(next.providers, key)) continue;
    next.providers[key] = { ...next.providers[key], ...value };
  }
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function maskApiKey(key) {
  const s = String(key || "");
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(Math.max(4, s.length - 8))}${s.slice(-4)}`;
}

/** Settings payload safe to send to the browser — API keys masked, never raw. */
export function publicSettings() {
  const { runner, providers } = loadSettings();
  const out = { runner, providers: {} };
  for (const [key, value] of Object.entries(providers)) {
    out.providers[key] = {
      ...value,
      apiKey: undefined,
      apiKeyMasked: maskApiKey(value.apiKey),
      configured: key === "cursor_agent_cli" ? true : Boolean(value.apiKey),
    };
    delete out.providers[key].apiKey;
  }
  return out;
}

/**
 * Resolve the effective config for the active runner, preferring saved
 * settings, then falling back to env vars for backward compatibility.
 */
export function resolveActiveProvider() {
  const { runner, providers } = loadSettings();
  const envRunner = process.env.ANALYST_RUNNER;
  if (envRunner && !KNOWN_RUNNERS.includes(envRunner)) {
    throw new Error(
      `Unknown ANALYST_RUNNER "${envRunner}" — expected one of: ${KNOWN_RUNNERS.join(", ")}`,
    );
  }
  const activeRunner = envRunner || runner;
  const saved = providers[activeRunner] || {};

  if (activeRunner === "anthropic_api") {
    return {
      runner: activeRunner,
      apiKey: saved.apiKey || process.env.ANTHROPIC_API_KEY || "",
      model: saved.model || process.env.ANALYST_MODEL || DEFAULT_MODELS.anthropic_api,
      baseUrl: process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages",
    };
  }
  if (activeRunner === "openai_api") {
    return {
      runner: activeRunner,
      apiKey: saved.apiKey || process.env.OPENAI_API_KEY || "",
      model: saved.model || process.env.OPENAI_MODEL || DEFAULT_MODELS.openai_api,
      baseUrl: "https://api.openai.com/v1/chat/completions",
    };
  }
  if (activeRunner === "openrouter_api") {
    return {
      runner: activeRunner,
      apiKey: saved.apiKey || process.env.OPENROUTER_API_KEY || "",
      model: saved.model || process.env.OPENROUTER_MODEL || DEFAULT_MODELS.openrouter_api,
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    };
  }
  if (activeRunner === "custom_openai_compatible") {
    return {
      runner: activeRunner,
      apiKey: saved.apiKey || process.env.CUSTOM_LLM_API_KEY || "",
      model: saved.model || process.env.CUSTOM_LLM_MODEL || "",
      baseUrl: saved.baseUrl || process.env.CUSTOM_LLM_BASE_URL || "",
    };
  }
  return {
    runner: "cursor_agent_cli",
    model: saved.model || process.env.ANALYST_MODEL || "claude-sonnet-5",
    effort: saved.effort || process.env.ANALYST_EFFORT || "high",
  };
}
