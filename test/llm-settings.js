/**
 * LLM settings persistence (.data/llm-settings.json) + runner resolution.
 * Run: node test/llm-settings.js
 *
 * Backs up/restores the real settings file around the test so a local dev
 * run never leaves stray state behind.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSettings,
  saveSettings,
  maskApiKey,
  publicSettings,
  resolveActiveProvider,
  KNOWN_RUNNERS,
} from "../lib/llm-settings.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = join(ROOT, ".data", "llm-settings.json");
const existedBefore = existsSync(SETTINGS_PATH);
const backup = existedBefore ? readFileSync(SETTINGS_PATH, "utf8") : null;

function restore() {
  if (existedBefore) {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    writeFileSync(SETTINGS_PATH, backup, "utf8");
  } else {
    rmSync(SETTINGS_PATH, { force: true });
  }
}

try {
  // Start from a clean slate for this test run.
  rmSync(SETTINGS_PATH, { force: true });

  // --- defaults with no file present ---
  {
    const settings = loadSettings();
    assert.equal(settings.runner, "cursor_agent_cli");
    assert.ok(KNOWN_RUNNERS.every((r) => settings.providers[r]));
  }

  // --- save + reload round-trip ---
  {
    saveSettings({
      runner: "anthropic_api",
      providers: { anthropic_api: { apiKey: "sk-ant-1234567890abcdef", model: "claude-opus-5" } },
    });
    const settings = loadSettings();
    assert.equal(settings.runner, "anthropic_api");
    assert.equal(settings.providers.anthropic_api.apiKey, "sk-ant-1234567890abcdef");
    assert.equal(settings.providers.anthropic_api.model, "claude-opus-5");
    // Untouched providers keep their defaults.
    assert.equal(settings.providers.openai_api.apiKey, "");
  }

  // --- partial save merges, doesn't clobber other providers ---
  {
    saveSettings({ providers: { openai_api: { apiKey: "sk-openai-abc", model: "gpt-5" } } });
    const settings = loadSettings();
    assert.equal(settings.providers.openai_api.apiKey, "sk-openai-abc");
    // Previous anthropic_api save still intact.
    assert.equal(settings.providers.anthropic_api.apiKey, "sk-ant-1234567890abcdef");
    assert.equal(settings.runner, "anthropic_api", "runner unchanged by a providers-only save");
  }

  // --- maskApiKey never leaks the middle of the key ---
  {
    assert.equal(maskApiKey(""), "");
    assert.equal(maskApiKey("short"), "•••••");
    const masked = maskApiKey("sk-ant-1234567890abcdef");
    assert.ok(masked.startsWith("sk-a"));
    assert.ok(masked.endsWith("cdef"));
    assert.ok(!masked.includes("1234567890"), "raw key material must not appear in masked output");
  }

  // --- publicSettings never includes a raw apiKey field ---
  {
    const pub = publicSettings();
    assert.equal(pub.runner, "anthropic_api");
    for (const provider of Object.values(pub.providers)) {
      assert.equal(provider.apiKey, undefined, "publicSettings must not expose raw apiKey");
    }
    assert.equal(pub.providers.anthropic_api.configured, true);
    assert.equal(pub.providers.openrouter_api.configured, false);
    assert.equal(pub.providers.cursor_agent_cli.configured, true, "cursor runner needs no key");
  }

  // --- resolveActiveProvider: saved settings win when ANALYST_RUNNER unset ---
  {
    delete process.env.ANALYST_RUNNER;
    const active = resolveActiveProvider();
    assert.equal(active.runner, "anthropic_api");
    assert.equal(active.apiKey, "sk-ant-1234567890abcdef");
    assert.equal(active.model, "claude-opus-5");
  }

  // --- resolveActiveProvider: explicit env var overrides saved settings ---
  {
    process.env.ANALYST_RUNNER = "openai_api";
    const active = resolveActiveProvider();
    assert.equal(active.runner, "openai_api");
    assert.equal(active.apiKey, "sk-openai-abc");
    delete process.env.ANALYST_RUNNER;
  }

  // --- resolveActiveProvider: env var falls back to process.env when unsaved ---
  {
    rmSync(SETTINGS_PATH, { force: true });
    process.env.ANTHROPIC_API_KEY = "sk-ant-fallback-0000";
    const active = resolveActiveProvider();
    assert.equal(active.runner, "cursor_agent_cli", "no saved settings, no env runner -> default");
    delete process.env.ANTHROPIC_API_KEY;
  }

  console.log("llm-settings tests: ok");
} finally {
  restore();
}
