/** @see skills/executor/SKILL.md */
export const AGENT_ID = "test_executor";
export const SKILL_PATH = "skills/executor/SKILL.md";
export const SKILL_FOLDER = "skills/executor";

import { farmCtx } from "./ctx-bridge.js";
import { redactParsedCurl } from "../lib/redaction.js";

export function blockedExecutorOutput(story, reason) {
  const tcIds = story?.test_cases || [];
  return {
    ticket: story?.id,
    blocked: true,
    blocked_reason: reason,
    execution_mode: "blocked — awaiting human input",
    requires_human_api: farmCtx.storyRequiresApi(story),
    requires_human_webpage: farmCtx.storyRequiresWebpage(story),
    human_api: farmCtx.humanApiInput.ok ? redactParsedCurl(farmCtx.humanApiInput) : null,
    human_webpage: farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null,
    execution_plan: tcIds.map((id) => ({
      test_case_id: id,
      data_source: "not available — human input required",
      method: "blocked",
      status: "blocked",
    })),
    results: [],
    summary: { planned: tcIds.length, executed: 0, passed: 0, failed: 0, blocked: tcIds.length, measured: false },
  };
}

function buildApiResult(tcId, api, executionResult) {
  if (!executionResult?.executed) {
    return {
      test_case_id: tcId,
      status: "not_executed",
      evidence: "API execution pending — submit curl and run against allowlisted target",
    };
  }
  const passed = executionResult.passed === true;
  return {
    test_case_id: tcId,
    status: passed ? "passed" : "failed",
    evidence: executionResult.evidence,
    http_status: executionResult.status,
    response_snippet: executionResult.response?.body_snippet,
    request: executionResult.request,
    response: executionResult.response,
  };
}

function buildWebResult(tcId, web) {
  return {
    test_case_id: tcId,
    status: "executed",
    evidence: `UI check recorded for ${web.url} (title: ${web.title || web.path}) — manual/browser verification required`,
    webpage: { url: web.url, title: web.title, path: web.path },
  };
}

export function buildTestExecutorOutput(story, api, webpage, executionResult) {
  const s = story.id;
  const tcIds = story.test_cases;
  const humanNeed = farmCtx.getLiveHumanInputNeed(story);
  const requiresApi = humanNeed.types.includes("api");
  const requiresWeb = humanNeed.types.includes("webpage");
  const web = webpage || (farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null);
  const prereq = farmCtx.getPrerequisiteCheck(story);
  const liveExecution = executionResult || farmCtx.executionResult || null;

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

  const safeApi = api?.ok ? redactParsedCurl(api) : null;
  const results = [];
  for (const id of tcIds) {
    if (requiresApi && api?.ok) results.push(buildApiResult(id, api, liveExecution));
    else if (requiresWeb && web?.ok) results.push(buildWebResult(id, web));
    else {
      results.push({
        test_case_id: id,
        status: "not_run",
        evidence: "No execution inputs required from human",
      });
    }
  }

  const executed = results.filter((r) => ["passed", "failed", "executed"].includes(r.status)).length;
  const passed = results.filter((r) => r.status === "passed" || r.status === "executed").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return {
    ticket: s,
    execution_mode,
    requires_human_api: requiresApi,
    requires_human_webpage: requiresWeb,
    human_api: safeApi,
    human_webpage: requiresWeb && web?.ok ? web : null,
    execution_plan: tcIds.map((id) => ({
      test_case_id: id,
      data_source: api?.ok
        ? `dataset/${id} → ${api.method} ${api.endpoint}`
        : web?.ok
          ? `dataset/${id} → navigate ${web.url}`
          : `fixtures/${s.toLowerCase()}/${id}.json`,
      method: api?.ok ? api.method : web?.ok ? "browser" : "none",
      status: executed > 0 ? "executed" : "planned",
    })),
    results,
    summary: {
      planned: tcIds.length,
      executed,
      passed,
      failed,
      blocked: 0,
      measured: executed > 0,
    },
  };
}
