/** @see .claude/skills/qa-author/SKILL.md */
import { hasStructuredOutput, dependencyBlockedOutput } from "./dependency-gate.js";

export const AGENT_ID = "author";
export const SKILL_PATH = ".claude/skills/qa-author/SKILL.md";
export const SKILL_FOLDER = ".claude/skills/qa-author";

const NOTE = "COMPLETE / Executor blocked until Author REVIEW — run the live Author (Playwright) on an approved outline.";

function out(status, reason, summary, extras = {}) {
  return {
    success: false, blocked: true, runner: "stub", status, session_id: null, steps: [],
    blocked_reason: reason, pipeline_note: NOTE, summary, outlines: [], requirement_verdicts: {},
    ...extras,
  };
}

const verdicts = (acs, evidence) => Object.fromEntries(
  (acs || []).map((c) => [c.id, { verdict: "blocked", evidence }]),
);

/** Author gate — REVIEW only from a verified live session; never fabricated. */
export function buildAuthorOutput(story, writerOutput, analystOutput, webpage) {
  if (!hasStructuredOutput("analyst", analystOutput)) {
    return { ...dependencyBlockedOutput("author", "BLOCKED — Author waiting on Analyst structured output"),
      ...out("NEEDS_INPUT", "BLOCKED — Author waiting on Analyst structured output", "Author blocked — Analyst output missing.") };
  }
  if (!hasStructuredOutput("writer", writerOutput)
    && !writerOutput?.test_cases?.length && !writerOutput?.test_outlines?.length) {
    return { ...dependencyBlockedOutput("author", "BLOCKED — Author waiting on Writer structured output"),
      ...out("NEEDS_INPUT", "BLOCKED — Author waiting on Writer structured output", "Author blocked — Writer output missing.") };
  }

  const conditions = analystOutput?.testable_conditions || [];
  const outlines = writerOutput?.test_outlines || (writerOutput?.test_cases || []).map((tc, i) => ({
    id: `TO-${String(i + 1).padStart(2, "0")}`, title: tc.title || tc.id,
    mapped_acs: tc.ac_ref ? [tc.ac_ref] : [], intent: tc.then || tc.title || "", status: "draft",
    tasks: [{ id: "T1", action: tc.when || "Execute scenario", validation: tc.expected_evidence || tc.then || "Observable pass evidence" }],
  }));

  if (!conditions.length) {
    return out("NEEDS_INPUT", "INVALID_REQUIREMENTS — zero testable conditions; Author will not invent steps.",
      "Author blocked — no validated acceptance criteria.");
  }

  const approved = outlines.filter((o) => o.status === "approved");
  if (outlines.length && !approved.length) {
    return out("PLAN_READY", "Approve at least one test outline before Author builds executable steps.",
      `${outlines.length} outline(s) awaiting human approval before Plan→Act→Reflect authoring.`,
      { outlines, requirement_verdicts: verdicts(conditions, "Outline not approved") });
  }

  const use = approved.length ? approved : outlines;
  if (!webpage?.ok || !webpage?.url) {
    return out("NEEDS_INPUT", "Target environment / page URL required for live authoring (Plan→Act→Reflect).",
      "Author ready to build once a target URL (and credentials if needed) are provided.",
      { outlines: use, requirement_verdicts: verdicts(conditions, "Missing target URL") });
  }

  const live = story?.live_author_output;
  if (live?.runner === "live" && approved.some((o) => o.id === live.outline_id)) {
    // Live Plan→Act→Reflect result for an approved outline (src/agents/liveAuthor.js).
    // Keep only verdicts for real Analyst ACs.
    const ids = new Set(conditions.map((c) => c.id));
    const requirement_verdicts = Object.fromEntries(
      Object.entries(live.requirement_verdicts || {}).filter(([id]) => ids.has(id)),
    );
    return { ...live, outlines: use, requirement_verdicts, pipeline_note: live.status === "REVIEW" ? null : NOTE };
  }

  const session_id = `auth-${story.id}-${Date.now().toString(36)}`;
  return out("BUILDING", "Ready for live authoring — run the live Author (Playwright) on an approved outline. No pass is fabricated meanwhile.",
    `Author session ${session_id} staged for ${conditions.length} AC(s) — run the live Author to Plan→Act→Reflect in a browser.`,
    { session_id, outlines: use, requirement_verdicts: verdicts(conditions, "Live authoring not run yet") });
}
