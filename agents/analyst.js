import { farmCtx } from "./ctx-bridge.js";/** @see skills/analyst/SKILL.md */
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
  const fn = typeof farmCtx.prerequisites.buildAnalystOutput === "function"
    ? farmCtx.prerequisites.buildAnalystOutput
    : null;
  if (fn) return fn(storyForPrerequisiteDetection(story));
  const legacyFn = typeof farmCtx.prerequisites.analyzeStoryPrerequisites === "function"
    ? farmCtx.prerequisites.analyzeStoryPrerequisites
    : typeof farmCtx.prerequisites.detectTicketPrerequisites === "function"
      ? farmCtx.prerequisites.detectTicketPrerequisites
      : null;
  if (!legacyFn) {
    return {
      success: true,
      scratchpad: {},
      testable_conditions: [],
      prerequisites_needed: { blocking: [], non_blocking: [] },
      coverage_gaps: [],
      needed: false,
      items: [],
      summary: "No prerequisites detected",
    };
  }
  return legacyFn(storyForPrerequisiteDetection(story));
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
