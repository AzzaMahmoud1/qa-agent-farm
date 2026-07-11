import { farmCtx } from "./ctx-bridge.js";
import { mergeNcaGapsIntoCoverage } from "../lib/nca-controls.js";

/** @see skills/analyst/SKILL.md */
export const AGENT_ID = "analyst";
export const SKILL_PATH = "skills/analyst/SKILL.md";
export const SKILL_FOLDER = "skills/analyst";

export function storyForPrerequisiteDetection(story) {
  return {
    title: story?.title || "",
    description: story?.description || "",
    acceptance_criteria_list: story?.acceptance_criteria_list || [],
    acceptance_criteria_entries: story?.acceptance_criteria_entries || [],
    acceptance_criteria_rejected: story?.acceptance_criteria_rejected || [],
    requirements_raw: story?.requirements_raw || "",
    components: story?.components || [],
    labels: story?.labels || [],
    id: story?.id,
    blocking_gaps: story?.blocking_gaps,
  };
}

export function buildAnalystOutputPayload(story) {
  // Agent 1 live result (Cursor Agent · Sonnet 5) — preferred over simulated prerequisites.js
  if (story?.live_analyst_output && typeof story.live_analyst_output === "object") {
    const live = { ...story.live_analyst_output };
    if (typeof live.scratchpad === "string") {
      live.scratchpad = { rendered: live.scratchpad };
    }
    live.success = live.success !== false;
    live.runner = live.runner || "cursor_agent_cli";
    return live;
  }

  const detected = storyForPrerequisiteDetection(story);
  const fn = typeof farmCtx.prerequisites.buildAnalystOutput === "function"
    ? farmCtx.prerequisites.buildAnalystOutput
    : null;
  let out;
  if (fn) {
    out = fn(detected);
  } else {
    const legacyFn = typeof farmCtx.prerequisites.analyzeStoryPrerequisites === "function"
      ? farmCtx.prerequisites.analyzeStoryPrerequisites
      : typeof farmCtx.prerequisites.detectTicketPrerequisites === "function"
        ? farmCtx.prerequisites.detectTicketPrerequisites
        : null;
    if (!legacyFn) {
      out = {
        success: true,
        scratchpad: {},
        testable_conditions: [],
        prerequisites_needed: { blocking: [], non_blocking: [] },
        coverage_gaps: [],
        needed: false,
        items: [],
        summary: "No prerequisites detected",
      };
    } else {
      out = legacyFn(detected);
    }
  }

  const { gaps, compliance_evidence } = mergeNcaGapsIntoCoverage(out.coverage_gaps || [], detected);
  out.coverage_gaps = gaps;
  out.compliance_evidence = compliance_evidence;
  if (compliance_evidence?.release_gate === "blocked") {
    out.ready_for_test_design = false;
    out.summary = `${out.summary || ""} NCA/ECC security evidence required before release.`.trim();
  }
  return out;
}

export function buildAnalystPrerequisitePayload(story) {
  const out = buildAnalystOutputPayload(story);
  return {
    needed: out.needed ?? (out.prerequisites_needed?.blocking || []).some((b) => !b.satisfied_by_ticket),
    items: out.items || [],
    already_satisfied: out.already_satisfied || [],
    not_applicable: out.not_applicable || [],
    blocking: out.prerequisites_needed?.blocking || out.blocking || [],
    non_blocking: out.prerequisites_needed?.non_blocking || out.non_blocking || [],
    reasoning: out.reasoning || out.summary || "",
    reasoning_steps: out.reasoning_steps || [],
    story_analysis: out.story_analysis || { test_actions: [], rejected_as_non_ac: [] },
    summary: out.summary || "",
    scratchpad: out.scratchpad,
  };
}
