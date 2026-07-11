import { farmCtx } from "./ctx-bridge.js";
import { mergeNcaGapsIntoCoverage } from "../lib/nca-controls.js";
import { inferHumanInputNeeds } from "../lib/human-input.js";

// The analyst turns detected API/UI test surfaces into explicit prerequisite items
// so the human is asked for a curl / page URL as part of Agent 1's analysis,
// instead of via a disconnected downstream gate.
export function buildAccessPrerequisiteItems(story, analystOutput) {
  const need = inferHumanInputNeeds(story, analystOutput, null);
  if (!need.needsHumanInput) return [];
  const requiredFor = String(need.detected_from || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "acceptance criteria");
  const items = [];
  if (need.types.includes("api")) {
    items.push({
      id: "access-api-curl",
      label: "API access — curl command",
      input_type: "api_curl",
      category: "environment",
      hint: "curl -X GET 'https://api.example.com/v2/resource' -H 'Authorization: Bearer TOKEN'",
      reason: need.reason,
      analyst_note: "Acceptance criteria exercise an API — the Test Data Extractor needs a working curl to derive valid/invalid/boundary datasets.",
      required_for: requiredFor,
    });
  }
  if (need.types.includes("webpage")) {
    items.push({
      id: "access-webpage-url",
      label: "UI access — page URL",
      input_type: "webpage_url",
      category: "environment",
      hint: "https://staging.example.com/app/dashboard",
      reason: need.reason,
      analyst_note: "Acceptance criteria exercise a UI surface — the Test Data Extractor needs the page URL to map UI test data.",
      required_for: requiredFor,
    });
  }
  return items;
}

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
  const accessItems = buildAccessPrerequisiteItems(story, out);
  const baseItems = out.items || [];
  const items = [
    ...baseItems,
    // Avoid duplicating an access item the analyst already produced.
    ...accessItems.filter((a) => !baseItems.some((b) => b.id === a.id || b.input_type === a.input_type)),
  ];
  return {
    needed: (out.needed ?? (out.prerequisites_needed?.blocking || []).some((b) => !b.satisfied_by_ticket)) || accessItems.length > 0,
    items,
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
