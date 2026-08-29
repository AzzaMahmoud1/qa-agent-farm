/**
 * Skill loader — reads `skills/<name>/SKILL.md` (+ optional
 * `schemas/output.schema.json`) from disk.
 *
 * The Analyst orchestrator runs each of
 * the five analysis skills as its OWN isolated pass, loading that skill's
 * SKILL.md as the prompt — one narrow job at a time, which is what suppresses
 * hallucination. The five skill files are the single source of truth, shared
 * with the Claude Code `qa-analyst` subagent.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SKILLS_DIR = join(REPO_ROOT, "skills");

/** The five analysis skills, in the order the Analyst applies them. */
export const ANALYST_SKILLS = Object.freeze({
  requirements_analysis: { always: true, advisory: false, findingsKey: "acceptance_criteria" },
  risk_analysis: { always: true, advisory: true, findingsKey: "risks" },
  test_gap_analysis: { always: true, advisory: true, findingsKey: "gaps" },
  source_analysis: { always: false, advisory: true, findingsKey: "impacts" },
  root_cause_analysis: { always: false, advisory: true, findingsKey: "root_causes" },
});

/**
 * Split a SKILL.md file into its YAML frontmatter block and its body. We do
 * not depend on a YAML parser — only `name`/`description` are read, and the
 * body (the prompt instructions) is what actually matters.
 * @param {string} text
 * @returns {{ frontmatter: string, body: string }}
 */
function splitFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: "", body: String(text).trim() };
  return { frontmatter: m[1], body: m[2].trim() };
}

/** Best-effort single-key read from a frontmatter block (`key: value`). */
function readFrontmatterKey(frontmatter, key) {
  const m = frontmatter.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
}

/**
 * Load one analysis skill by name.
 * @param {string} name — folder under skills/ (e.g. "requirements_analysis")
 * @returns {{ name: string, description: string, instructions: string, path: string, schema: object|null }}
 */
export function loadSkill(name) {
  const skillDir = join(SKILLS_DIR, name);
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    throw new Error(`No SKILL.md found for skill '${name}' at ${skillMd}`);
  }
  const { frontmatter, body } = splitFrontmatter(readFileSync(skillMd, "utf8"));

  let schema = null;
  const schemaPath = join(skillDir, "schemas", "output.schema.json");
  if (existsSync(schemaPath)) {
    try {
      schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    } catch { /* a malformed schema is non-fatal — grounding still applies */ }
  }

  return {
    name: readFrontmatterKey(frontmatter, "name") || name,
    description: readFrontmatterKey(frontmatter, "description"),
    instructions: body,
    path: skillMd,
    schema,
  };
}
