/** @see .cursor/skills/qa-author/SKILL.md */
import { hasStructuredOutput, dependencyBlockedOutput } from "./dependency-gate.js";

export const AGENT_ID = "author";
export const SKILL_PATH = ".cursor/skills/qa-author/SKILL.md";
export const SKILL_FOLDER = ".cursor/skills/qa-author";

/**
 * Stub Author agent (mabl-style Plan → Act → Reflect).
 * S2 will drive Playwright against an approved outline; until then this agent
 * returns a blocked/pending session that cannot fabricate a pass.
 *
 * @param {object} story
 * @param {object} [writerOutput] — test_cases and/or test_outlines
 * @param {object} [analystOutput]
 * @param {{ url?: string, ok?: boolean } | null} [webpage]
 */
export function buildAuthorOutput(story, writerOutput, analystOutput, webpage) {
  if (!hasStructuredOutput("analyst", analystOutput)) {
    return {
      ...dependencyBlockedOutput("author", "BLOCKED — Author waiting on Analyst structured output"),
      status: "NEEDS_INPUT",
      session_id: null,
      outlines: [],
      steps: [],
      requirement_verdicts: {},
      summary: "Author blocked — Analyst output missing.",
    };
  }
  if (!hasStructuredOutput("writer", writerOutput)
    && !(Array.isArray(writerOutput?.test_cases) && writerOutput.test_cases.length)
    && !(Array.isArray(writerOutput?.test_outlines) && writerOutput.test_outlines.length)) {
    return {
      ...dependencyBlockedOutput("author", "BLOCKED — Author waiting on Writer structured output"),
      status: "NEEDS_INPUT",
      session_id: null,
      outlines: [],
      steps: [],
      requirement_verdicts: {},
      summary: "Author blocked — Writer output missing.",
    };
  }

  const conditions = analystOutput?.testable_conditions || [];
  const outlines = writerOutput?.test_outlines
    || (writerOutput?.test_cases || []).map((tc, i) => ({
      id: `TO-${String(i + 1).padStart(2, "0")}`,
      title: tc.title || tc.id,
      mapped_acs: tc.ac_ref ? [tc.ac_ref] : [],
      intent: tc.then || tc.title || "",
      status: "draft",
      tasks: [{
        id: "T1",
        action: tc.when || "Execute scenario",
        validation: tc.expected_evidence || tc.then || "Observable pass evidence",
      }],
    }));

  if (!conditions.length) {
    return {
      success: false,
      status: "NEEDS_INPUT",
      blocked: true,
      blocked_reason: "INVALID_REQUIREMENTS — zero testable conditions; Author will not invent steps.",
      session_id: null,
      outlines: [],
      steps: [],
      requirement_verdicts: {},
      summary: "Author blocked — no validated acceptance criteria.",
    };
  }

  const approved = outlines.filter((o) => o.status === "approved");
  const pendingApproval = outlines.length > 0 && approved.length === 0;
  const hasUrl = Boolean(webpage?.ok && webpage?.url);

  if (pendingApproval) {
    return {
      success: false,
      status: "PLAN_READY",
      blocked: true,
      blocked_reason: "Approve at least one test outline before Author builds executable steps.",
      session_id: null,
      outlines,
      steps: [],
      requirement_verdicts: Object.fromEntries(
        conditions.map((c) => [c.id, { verdict: "blocked", evidence: "Outline not approved" }]),
      ),
      summary: `${outlines.length} outline(s) awaiting human approval before Plan→Act→Reflect authoring.`,
    };
  }

  if (!hasUrl && !webpage?.ok) {
    return {
      success: false,
      status: "NEEDS_INPUT",
      blocked: true,
      blocked_reason: "Target environment / page URL required for live authoring (Plan→Act→Reflect).",
      session_id: null,
      outlines: approved.length ? approved : outlines,
      steps: [],
      requirement_verdicts: Object.fromEntries(
        conditions.map((c) => [c.id, { verdict: "blocked", evidence: "Missing target URL" }]),
      ),
      summary: "Author ready to build once a target URL (and credentials if needed) are provided.",
    };
  }

  // S2 placeholder: real Playwright authoring not wired yet.
  const sessionId = `auth-${story.id}-${Date.now().toString(36)}`;
  return {
    success: false,
    status: "BUILDING",
    blocked: true,
    blocked_reason: "Author Playwright loop not implemented yet (S2). Session reserved; no fabricated pass.",
    session_id: sessionId,
    outlines: approved.length ? approved : outlines,
    steps: [],
    requirement_verdicts: Object.fromEntries(
      conditions.map((c) => [c.id, { verdict: "blocked", evidence: "Author runtime pending S2" }]),
    ),
    summary: `Author session ${sessionId} staged for ${conditions.length} AC(s) — live Plan→Act→Reflect coming in S2.`,
  };
}
