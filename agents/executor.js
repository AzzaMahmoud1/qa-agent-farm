/** @see skills/executor/SKILL.md */
export const AGENT_ID = "test_executor";
export const SKILL_PATH = "skills/executor/SKILL.md";
export const SKILL_FOLDER = "skills/executor";

import { farmCtx } from "./ctx-bridge.js";

export function blockedExecutorOutput(story, reason) {
  const tcIds = story?.test_cases || [];
  return {
    ticket: story?.id,
    blocked: true,
    blocked_reason: reason,
    execution_mode: "blocked — awaiting human input",
    requires_human_api: farmCtx.storyRequiresApi(story),
    requires_human_webpage: farmCtx.storyRequiresWebpage(story),
    human_api: farmCtx.humanApiInput.ok ? farmCtx.humanApiInput : null,
    human_webpage: farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null,
    execution_plan: tcIds.map((id) => ({
      test_case_id: id,
      data_source: "not available — human input required",
      method: "blocked",
      status: "blocked",
    })),
    results: [],
    summary: { planned: tcIds.length, executed: 0, passed: 0, failed: 0, blocked: tcIds.length },
  };
}

export function buildTestExecutorOutput(story, api, webpage) {
  const s = story.id;
  const tcIds = story.test_cases;
  const humanNeed = farmCtx.getLiveHumanInputNeed(story);
  const requiresApi = humanNeed.types.includes("api");
  const requiresWeb = humanNeed.types.includes("webpage");
  const web = webpage || (farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null);
  const prereq = farmCtx.getPrerequisiteCheck(story);

  if (prereq.needed && !farmCtx.isPrerequisitesSatisfied()) {
    return blockedExecutorOutput(story, "Confirm prerequisites before running tests.");
  }
  if (humanNeed.needsHumanInput && !farmCtx.isHumanInputSatisfied(humanNeed)) {
    return blockedExecutorOutput(story, humanNeed.action || "Provide required human input before execution.");
  }
  if (requiresApi && !api?.ok) {
    return blockedExecutorOutput(story, "Provide a curl command before execution.");
  }
  if (requiresWeb && !web?.ok) {
    return blockedExecutorOutput(story, "Provide a webpage URL before execution.");
  }

  let execution_mode = "planned";
  if (requiresApi && requiresWeb) execution_mode = "api + ui (human-provided)";
  else if (requiresApi) execution_mode = "api (human-provided curl)";
  else if (requiresWeb) execution_mode = "ui (human-provided webpage)";
  else execution_mode = "not run — no execution inputs required";

  const canExecute = (requiresApi && api?.ok) || (requiresWeb && web?.ok);
  return {
    ticket: s,
    execution_mode,
    requires_human_api: requiresApi,
    requires_human_webpage: requiresWeb,
    human_api: requiresApi && api?.ok ? api : null,
    human_webpage: requiresWeb && web?.ok ? web : null,
    execution_plan: tcIds.map((id) => ({
      test_case_id: id,
      data_source: api?.ok
        ? `dataset/${id} → ${api.method} ${api.endpoint}`
        : web?.ok
          ? `dataset/${id} → navigate ${web.url}`
          : `fixtures/${s.toLowerCase()}/${id}.json`,
      method: api?.ok ? api.method : web?.ok ? "browser" : "none",
      status: canExecute ? "planned" : "not run",
    })),
    results: canExecute
      ? tcIds.map((id) => ({
          test_case_id: id,
          status: "planned",
          evidence: api?.ok
            ? `Run ${api.method} ${api.url} with dataset/${id}`
            : `Open ${web.url} with dataset/${id}`,
        }))
      : tcIds.map((id) => ({
          test_case_id: id,
          status: "not run",
          evidence: "No execution inputs required from human",
        })),
    summary: { planned: tcIds.length, executed: 0, passed: 0, failed: 0, blocked: 0 },
  };
}
