/** @see .cursor/skills/qa-writer/SKILL.md */
import { hasStructuredOutput, dependencyBlockedOutput } from "./dependency-gate.js";

export const AGENT_ID = "writer";
export const SKILL_PATH = ".cursor/skills/qa-writer/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-writer";

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function inferTcType(acText, index) {
  const t = String(acText || "").toLowerCase();
  if (/\b(invalid|reject|deny|error|fail|unauthorized|forbidden|must not|shall not|wrong|empty)\b/.test(t)) return "negative";
  if (/\b(edge|boundary|limit|maximum|minimum|expires?|timeout|concurrent|duplicate|overflow)\b/.test(t)) return "edge_case";
  if (/\b(security|cross-tenant|escalat|only their own|may not)\b/.test(t)) return "security";
  return "happy_path";
}

/** Sources: Analyst conditions, else story AC list. */
function acSources(story, analystOutput) {
  const conditions = analystOutput?.testable_conditions || [];
  if (conditions.length) {
    return conditions.map((c, i) => ({
      id: c.id || `AC-${i + 1}`,
      // Analyst schema uses ac_text / testable_statement (not text)
      text: c.ac_text || c.testable_statement || c.text || c.condition || c.id || "Acceptance criterion",
    }));
  }
  const list = story.acceptance_criteria_list || [];
  const ids = story.test_cases || [];
  const n = Math.max(ids.length, list.length);
  if (!n) return [];
  return Array.from({ length: n }, (_, i) => ({
    id: `AC-${i + 1}`,
    text: list[i] || list[0] || story.title || "Scenario",
    tcId: ids[i],
  }));
}

export function buildWriterOutlines(story, analystOutput) {
  const src = acSources(story, analystOutput);
  return src.map((c, i) => ({
    id: `TO-${String(i + 1).padStart(2, "0")}`,
    title: clip(c.text, 80),
    mapped_acs: [c.id],
    intent: inferTcType(c.text, i),
    preconditions: [],
    tasks: [{ id: "T1", action: `Exercise ${c.id}: ${clip(c.text, 100)}`, validation: c.text }],
    status: "draft",
  }));
}

export function buildCoverageMatrix(outlines) {
  return (outlines || []).reduce((m, o) => {
    for (const ac of o.mapped_acs || []) (m[ac] ||= []).push(o.id);
    return m;
  }, {});
}

export function buildWriterTestCases(story, analystOutput) {
  const s = story.id;
  const given = story.from_requirements
    ? `Requirements ${s} loaded from pasted description`
    : `Ticket ${s} is loaded with JIRA context`;
  return acSources(story, analystOutput).map((c, i) => {
    const type = inferTcType(c.text, i);
    const happy = type === "happy_path";
    return {
      id: c.tcId || `TC-${String(i + 1).padStart(2, "0")}`,
      ac_ref: c.id,
      title: clip(c.text, 80),
      type,
      given,
      when: `Scenario exercises ${c.id}: ${clip(c.text, 60)}`,
      then: happy ? "Expected behavior passes per AC" : "System rejects or handles edge correctly",
      expected_evidence: happy ? "HTTP 200 / success response" : "HTTP 4xx with clear error",
      suggested_file: `tests/api/${String(s).toLowerCase()}.spec.ts`,
      documentation_only: true,
    };
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
