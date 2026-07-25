/** @see .cursor/skills/qa-writer/SKILL.md */
import { hasStructuredOutput, dependencyBlockedOutput } from "./dependency-gate.js";
import { acTextNeedsApi, acTextNeedsWeb, inferHumanInputNeeds } from "../lib/human-input.js";

export const AGENT_ID = "writer";
export const SKILL_PATH = ".cursor/skills/qa-writer/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-writer";

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function sentenceCase(s) {
  const t = String(s || "").trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Classify intent from AC text.
 * "shall not require deployment" is a positive constraint (no deploy needed), not a negative test.
 * Strip that phrasing before matching must/shall not prohibition patterns.
 */
export function inferTcType(acText, index) {
  const raw = String(acText || "").toLowerCase();
  const t = raw.replace(/\b(shall|must|should)\s+not\s+(require|need)\b/g, " ");
  if (/\b(invalid|reject|deny|error|fail|unauthorized|forbidden|must not|shall not|wrong|empty)\b/.test(t)) {
    return "negative";
  }
  if (/\b(edge|boundary|limit|maximum|minimum|expires?|timeout|concurrent|duplicate|overflow)\b/.test(t)) {
    return "edge_case";
  }
  if (/\b(security|cross-tenant|escalat|only their own|may not)\b/.test(t)) return "security";
  return "happy_path";
}

/** Short readable test name, prefixed with AC id. Full AC stays on `ac_text`. */
export function shortTestTitle(acId, acText, maxNameLen = 64) {
  let name = String(acText || "").trim().replace(/\s+/g, " ");
  name = name
    .replace(/^(the\s+)?(system|seha|application|app|platform)\s+(shall|must|should|will)\s+/i, "")
    .replace(/^(a\s+|an\s+|the\s+)?(user|admin|customer|operator)\s+(can|shall|must|should|will|may)\s+/i, "")
    .replace(/^(it\s+)?(shall|must|should|will)\s+/i, "")
    .replace(/^(ensure|verify|confirm)\s+(that\s+)?/i, "");
  name = sentenceCase(name || String(acText || "Scenario").trim());
  const id = String(acId || "AC").trim() || "AC";
  return `${id} · ${clip(name, maxNameLen)}`;
}

/** Sources: Analyst conditions, else story AC list. Carry full Analyst fields through. */
function acSources(story, analystOutput) {
  const conditions = analystOutput?.testable_conditions || [];
  if (conditions.length) {
    return conditions.map((c, i) => {
      const ac_text = c.ac_text || c.testable_statement || c.text || c.condition || c.id || "Acceptance criterion";
      return {
        id: c.id || `AC-${i + 1}`,
        ac_text,
        // Alias for title / type inference
        text: ac_text,
        roles: Array.isArray(c.roles) ? c.roles.filter(Boolean) : [],
        testable_statement: c.testable_statement || "",
        pass_evidence: c.pass_evidence || "",
        fail_evidence: c.fail_evidence || "",
        source: c.source || "",
        tcId: c.tcId,
      };
    });
  }
  const list = story.acceptance_criteria_list || [];
  const ids = story.test_cases || [];
  const n = Math.max(ids.length, list.length);
  if (!n) return [];
  return Array.from({ length: n }, (_, i) => ({
    id: `AC-${i + 1}`,
    ac_text: list[i] || list[0] || story.title || "Scenario",
    text: list[i] || list[0] || story.title || "Scenario",
    roles: [],
    testable_statement: "",
    pass_evidence: "",
    fail_evidence: "",
    source: "",
    tcId: ids[i],
  }));
}

/**
 * Parse "System MUST [verb] [object] when [trigger] for [role]" → trigger clause.
 * Returns null when the statement does not contain a usable when-clause.
 */
export function parseWhenTrigger(statement) {
  const s = String(statement || "").trim();
  if (!s) return null;
  const m = s.match(/\bwhen\s+(.+?)(?:\s+for\s+\S.*)?$/i);
  if (!m) return null;
  const trigger = m[1].trim().replace(/[.\s]+$/, "");
  return trigger || null;
}

/** Imperative from verb/object when when-clause is missing. */
export function imperativeFromStatement(statement, acText) {
  const s = String(statement || "").trim();
  const m = s.match(/^System\s+MUST\s+(.+?)(?:\s+when\s+|\s+for\s+|$)/i);
  if (m?.[1]) return sentenceCase(m[1].trim());
  const t = String(acText || "").trim();
  if (t) return sentenceCase(t);
  return "Exercise the acceptance criterion";
}

export function buildWhenClause(condition) {
  const trigger = parseWhenTrigger(condition.testable_statement);
  if (trigger) return sentenceCase(trigger);
  return imperativeFromStatement(condition.testable_statement, condition.ac_text || condition.text);
}

function contextHintFromAc(acText) {
  const t = String(acText || "").toLowerCase();
  if (/\blog\s*in|sign\s*in|nafath|credential|password\b/.test(t)) return "on the login page";
  if (/\bupload|attach|file\b/.test(t)) return "ready to upload or attach a file";
  if (/\bdashboard|home screen|portal\b/.test(t)) return "on the relevant application screen";
  return "ready to exercise the scenario";
}

export function buildGivenClause(roles, acText) {
  const roleList = (roles || []).filter(Boolean);
  if (!roleList.length) {
    return "The actor is in a valid starting state for the scenario";
  }
  const role = String(roleList[0]).trim();
  // "user" is /juː…/ — use "A", not "An".
  const article = /^(a|e|i|o|u)/i.test(role) && !/^user\b/i.test(role) ? "An" : "A";
  return `${article} ${role} is ${contextHintFromAc(acText)}`;
}

function isPositiveIntent(type) {
  return type === "happy_path";
}

/**
 * Then = observable outcome when the case passes.
 * Prefer Analyst pass_evidence for every intent (including negative ACs — rejection
 * is the pass observation). For negative/edge, fall back to fail_evidence only when
 * pass_evidence is empty. Never invent a constant string without needs_detail.
 */
export function buildThenClause(type, passEvidence, failEvidence) {
  const pass = String(passEvidence || "").trim();
  const fail = String(failEvidence || "").trim();
  if (pass) return { then: pass, needs_detail: false };
  if (!isPositiveIntent(type) && fail) return { then: fail, needs_detail: false };
  if (fail) return { then: fail, needs_detail: false };
  return {
    then: "Observable pass/fail evidence was not supplied by the Analyst",
    needs_detail: true,
  };
}

/** Same source as Then — never synthesize HTTP status codes. */
export function buildExpectedEvidence(type, passEvidence, failEvidence) {
  const { then, needs_detail } = buildThenClause(type, passEvidence, failEvidence);
  if (needs_detail) return null;
  return then || null;
}

export function suggestTestFile(story, analystOutput) {
  const needs = inferHumanInputNeeds(story, analystOutput || {}, []);
  const types = new Set(needs.types || []);
  // Also scan Analyst condition fields directly (story AC list may be empty).
  for (const c of analystOutput?.testable_conditions || []) {
    const blob = [c.ac_text, c.testable_statement, c.pass_evidence, c.fail_evidence].filter(Boolean).join(" ");
    if (acTextNeedsApi(blob)) types.add("api");
    if (acTextNeedsWeb(blob)) types.add("webpage");
  }
  if (!types.size) return undefined;
  const id = String(story?.id || "story").toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "story";
  // Prefer e2e when a webpage surface is in scope; api only for API-only detection.
  if (types.has("webpage")) return `tests/e2e/${id}.spec.ts`;
  if (types.has("api")) return `tests/api/${id}.spec.ts`;
  return undefined;
}

function sourceRefForStory(story) {
  const s = story?.id || "story";
  if (story?.from_requirements) return `Requirements ${s} loaded from pasted description`;
  if (story?.from_jira) return `Ticket ${s} is loaded with JIRA context`;
  return undefined;
}

export function buildWriterOutlines(story, analystOutput) {
  const src = acSources(story, analystOutput);
  return src.map((c, i) => {
    const when = buildWhenClause(c);
    const type = inferTcType(c.text, i);
    const { then } = buildThenClause(type, c.pass_evidence, c.fail_evidence);
    const validation = String(c.pass_evidence || "").trim()
      || (isPositiveIntent(type) ? then : String(c.fail_evidence || "").trim() || then);
    return {
      id: `TO-${String(i + 1).padStart(2, "0")}`,
      title: shortTestTitle(c.id, c.ac_text),
      ac_text: c.ac_text,
      mapped_acs: [c.id],
      intent: type,
      preconditions: c.roles.length ? [buildGivenClause(c.roles, c.ac_text)] : [],
      tasks: [{ id: "T1", action: when, validation }],
      status: "draft",
    };
  });
}

export function buildCoverageMatrix(outlines) {
  return (outlines || []).reduce((m, o) => {
    for (const ac of o.mapped_acs || []) (m[ac] ||= []).push(o.id);
    return m;
  }, {});
}

export function buildWriterTestCases(story, analystOutput) {
  const source_ref = sourceRefForStory(story);
  const suggested = suggestTestFile(story, analystOutput);
  return acSources(story, analystOutput).map((c, i) => {
    const type = inferTcType(c.text, i);
    const given = buildGivenClause(c.roles, c.ac_text);
    const when = buildWhenClause(c);
    const { then, needs_detail } = buildThenClause(type, c.pass_evidence, c.fail_evidence);
    const expected_evidence = buildExpectedEvidence(type, c.pass_evidence, c.fail_evidence);
    const tc = {
      id: c.tcId || `TC-${String(i + 1).padStart(2, "0")}`,
      ac_ref: c.id,
      title: shortTestTitle(c.id, c.ac_text),
      ac_text: c.ac_text,
      type,
      given,
      when,
      then,
      documentation_only: true,
    };
    if (source_ref) tc.source_ref = source_ref;
    if (c.source) tc.ac_source = c.source;
    if (expected_evidence) tc.expected_evidence = expected_evidence;
    if (suggested) tc.suggested_file = suggested;
    if (needs_detail) tc.needs_detail = true;
    return tc;
  });
}

export function buildWriterOutput(story, analystOutput) {
  if (!hasStructuredOutput("analyst", analystOutput)) {
    return {
      ...dependencyBlockedOutput("writer", "BLOCKED — Writer waiting on Analyst structured output"),
      runner: "stub", test_cases: [], test_outlines: [], coverage_matrix: {},
    };
  }
  const test_outlines = buildWriterOutlines(story, analystOutput);
  return {
    success: true, blocked: false, runner: "stub",
    test_outlines,
    coverage_matrix: buildCoverageMatrix(test_outlines),
    test_cases: buildWriterTestCases(story, analystOutput),
    analyst_input: {
      testable_conditions: analystOutput.testable_conditions,
      prerequisites_needed: analystOutput.prerequisites_needed,
    },
    summary: `${test_outlines.length} outline(s) drafted — approve before Author builds.`,
  };
}
