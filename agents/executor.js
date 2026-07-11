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
    orchestration_mode: "simulated_pipeline",
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
    summary: {
      planned: tcIds.length,
      executed: 0,
      passed: 0,
      failed: 0,
      blocked: tcIds.length,
      pending_browser: 0,
      transport_observed: 0,
      measured: false,
    },
  };
}

/**
 * HTTP transport smoke applies to at most one case as observation — never as a
 * business/AC pass for every TC.
 */
function buildApiResults(tcIds, api, executionResult, writerCases) {
  const results = [];
  if (!executionResult?.executed) {
    return tcIds.map((id) => ({
      test_case_id: id,
      status: "not_executed",
      assertion_level: "none",
      evidence: "API execution pending — submit curl and run against allowlisted target",
    }));
  }

  const smokeId = tcIds[0];
  for (const id of tcIds) {
    const writerTc = (writerCases || []).find((tc) => tc.id === id);
    if (id === smokeId) {
      results.push({
        test_case_id: id,
        status: "transport_observed",
        assertion_level: "transport_only",
        http_ok: executionResult.http_ok === true,
        http_status: executionResult.status,
        passed: false,
        evidence: `${executionResult.evidence} — NOT a per-AC pass; business assertions not evaluated for ${id}`,
        ac_ref: writerTc?.ac_ref || null,
        expected_evidence: writerTc?.expected_evidence || null,
        request: executionResult.request,
        response: executionResult.response,
        audit: executionResult.audit || [],
      });
    } else {
      results.push({
        test_case_id: id,
        status: "not_executed",
        assertion_level: "per_ac_required",
        passed: false,
        evidence: `Per-AC assertion not run for ${id} — single HTTP ${executionResult.status} transport observation must not be copied as pass`,
        ac_ref: writerTc?.ac_ref || null,
        expected_evidence: writerTc?.expected_evidence || null,
      });
    }
  }
  return results;
}

function buildWebResults(tcIds, web, writerCases) {
  return tcIds.map((id) => {
    const writerTc = (writerCases || []).find((tc) => tc.id === id);
    return {
      test_case_id: id,
      status: "pending_browser",
      assertion_level: "browser_required",
      passed: false,
      evidence: `Webpage URL recorded (${web.url}) — NOT executed; browser/Playwright evidence required before pass`,
      webpage: { url: web.url, title: web.title, path: web.path },
      ac_ref: writerTc?.ac_ref || null,
      expected_evidence: writerTc?.expected_evidence || null,
    };
  });
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
  const writerCases = farmCtx.storyOutputs?.writer?.test_cases || [];

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
  if (requiresApi && requiresWeb) execution_mode = "api transport smoke + ui pending browser";
  else if (requiresApi) execution_mode = "api transport smoke (human-provided curl)";
  else if (requiresWeb) execution_mode = "ui pending browser (URL recorded only)";
  else execution_mode = "not run — no execution inputs required";

  const safeApi = api?.ok ? redactParsedCurl(api) : null;
  let results = [];

  if (requiresApi && api?.ok && requiresWeb && web?.ok) {
    const apiResults = buildApiResults(tcIds, api, liveExecution, writerCases);
    const webOverlay = buildWebResults(tcIds, web, writerCases);
    results = apiResults.map((r, i) => ({
      ...r,
      ui_status: webOverlay[i]?.status,
      ui_evidence: webOverlay[i]?.evidence,
    }));
  } else if (requiresApi && api?.ok) {
    results = buildApiResults(tcIds, api, liveExecution, writerCases);
  } else if (requiresWeb && web?.ok) {
    results = buildWebResults(tcIds, web, writerCases);
  } else {
    results = tcIds.map((id) => ({
      test_case_id: id,
      status: "not_run",
      assertion_level: "none",
      passed: false,
      evidence: "No execution inputs required from human",
    }));
  }

  const transportObserved = results.filter((r) => r.status === "transport_observed").length;
  const pendingBrowser = results.filter((r) => r.status === "pending_browser" || r.ui_status === "pending_browser").length;
  const executed = results.filter((r) => r.status === "passed" || r.status === "failed").length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  // measured only when real per-AC assertions exist — transport/UI URL alone is not measured pass coverage
  const measured = passed + failed > 0;

  return {
    ticket: s,
    execution_mode,
    orchestration_mode: "simulated_pipeline",
    orchestration_note: "Validator/agent loop is a scripted simulator; only /api/execute performs a live HTTP transport call",
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
      status: results.find((r) => r.test_case_id === id)?.status || "planned",
    })),
    results,
    summary: {
      planned: tcIds.length,
      executed,
      passed,
      failed,
      blocked: 0,
      pending_browser: pendingBrowser,
      transport_observed: transportObserved,
      measured,
    },
  };
}
