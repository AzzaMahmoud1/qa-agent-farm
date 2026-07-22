import { createAgentFarm } from "../agents/index.js";
import {
  FALLBACK_STORIES, AGENT_ROLES, PIPELINE_STEPS, AGENT_META, AGENT_GUIDELINES,
  VALIDATOR_MAX_ATTEMPTS, ORCHESTRATOR_INACTIVITY_TIMEOUT_MS, VALIDATOR_GUIDELINES, OUTPUT_ROLES,
  MODEL_ORCHESTRATOR, MODEL_WORKER, getModelForAgent,
} from "../agents/registry.js";

/** Prerequisites loaded via classic script (lib/prerequisites.js → window.*) */
const prerequisites = {
  analyzeStoryPrerequisites: window.analyzeStoryPrerequisites,
  buildAnalystOutput: window.buildAnalystOutput,
  detectTicketPrerequisites: window.detectTicketPrerequisites,
  sanitizeAcceptanceCriteria: window.sanitizeAcceptanceCriteria,
  isLikelyAcceptanceCriterion: window.isLikelyAcceptanceCriterion,
  isStrongAcceptanceCriterion: window.isStrongAcceptanceCriterion,
  isFlowOrScenarioLine: window.isFlowOrScenarioLine,
  isUseCaseSectionHeader: window.isUseCaseSectionHeader,
  isMetadataLine: window.isMetadataLine,
  validateAnalystOutput: window.validateAnalystOutput,
  parseFullRequirements: window.parseFullRequirements,
  mergeRejectedLines: window.mergeRejectedLines,
  buildScratchpad: window.buildScratchpad,
};
import { parseCurl, parseWebpageInput, formatCurlPreview, inferHumanInputNeeds } from "../lib/human-input.js";
import { redactParsedCurl, redactString } from "../lib/redaction.js";
import { parseRequirementsDescription, issueToStory } from "../lib/story.js";
import { buildRequirementsFromStory, getLiveRequirements } from "../lib/requirements.js";

const el = (id) => document.getElementById(id);

// --- mutable runtime state (ctx) ---
let currentStory = null;
let jiraConfigured = false;
let agentOutputs = {};
let agentStatuses = {};
let activeOutputTab = "orchestrator";
let currentRunOptions = {};
let agentChangeLog = {};
let humanApiInput = { ok: false, curl: "", base_url: "", endpoint: "", method: "GET", url: "", headers: {}, auth: "", body: null };
let humanWebpageInput = { ok: false, url: "", path: "", origin: "", title: "" };
let cachedHumanInputNeed = null;
let orchestratorInactivityTimer = null;
let orchestratorInactivityCountdownInterval = null;
let orchestratorInactivityDeadline = null;
let pausedForHumanInput = false;
let userPrerequisites = {};
let cachedPrerequisiteCheck = null;
/** @type {"RUNNING"|"WAITING_ON_HUMAN"|"NEEDS_INPUT"|"READY_FOR_WRITER"} */
let pipelineState = "RUNNING";
/** @type {Array<{action?:string,target?:string,detail?:string,blocking?:boolean,resolved?:boolean}>} */
let blockingOrchestratorActions = [];
// Whether the prerequisites panel is currently surfacing the API curl / webpage input fields.
let prereqShowsApi = false;
let prereqShowsWeb = false;

let idx = -1;
let EVENTS = [];
let playing = false;
let timer = null;
let storyOutputs = {};
let currentInputSource = "jira";
let executionResult = null;

// --- bootstrap agent farm ---
const ctx = {
  prerequisites,
  el,
};
Object.assign(ctx, {
  get currentStory() { return currentStory; },
  set currentStory(v) { currentStory = v; },
  get storyOutputs() { return storyOutputs; },
  set storyOutputs(v) { storyOutputs = v; },
  get EVENTS() { return EVENTS; },
  set EVENTS(v) { EVENTS = v; },
  get idx() { return idx; },
  set idx(v) { idx = v; },
  get humanApiInput() { return humanApiInput; },
  set humanApiInput(v) { humanApiInput = v; },
  get humanWebpageInput() { return humanWebpageInput; },
  set humanWebpageInput(v) { humanWebpageInput = v; },
  get userPrerequisites() { return userPrerequisites; },
  set userPrerequisites(v) { userPrerequisites = v; },
  get cachedPrerequisiteCheck() { return cachedPrerequisiteCheck; },
  set cachedPrerequisiteCheck(v) { cachedPrerequisiteCheck = v; },
  get cachedHumanInputNeed() { return cachedHumanInputNeed; },
  set cachedHumanInputNeed(v) { cachedHumanInputNeed = v; },
  get agentOutputs() { return agentOutputs; },
  set agentOutputs(v) { agentOutputs = v; },
  get agentStatuses() { return agentStatuses; },
  set agentStatuses(v) { agentStatuses = v; },
  get activeOutputTab() { return activeOutputTab; },
  set activeOutputTab(v) { activeOutputTab = v; },
  get currentRunOptions() { return currentRunOptions; },
  set currentRunOptions(v) { currentRunOptions = v; },
  get agentChangeLog() { return agentChangeLog; },
  set agentChangeLog(v) { agentChangeLog = v; },
  get currentInputSource() { return currentInputSource; },
  set currentInputSource(v) { currentInputSource = v; },
  get jiraConfigured() { return jiraConfigured; },
  set jiraConfigured(v) { jiraConfigured = v; },
  get playing() { return playing; },
  set playing(v) { playing = v; },
  get pausedForHumanInput() { return pausedForHumanInput; },
  set pausedForHumanInput(v) { pausedForHumanInput = v; },
  get orchestratorInactivityTimer() { return orchestratorInactivityTimer; },
  set orchestratorInactivityTimer(v) { orchestratorInactivityTimer = v; },
  get orchestratorInactivityCountdownInterval() { return orchestratorInactivityCountdownInterval; },
  set orchestratorInactivityCountdownInterval(v) { orchestratorInactivityCountdownInterval = v; },
  get orchestratorInactivityDeadline() { return orchestratorInactivityDeadline; },
  set orchestratorInactivityDeadline(v) { orchestratorInactivityDeadline = v; },
  get executionResult() { return executionResult; },
  set executionResult(v) { executionResult = v; },
});

const farm = createAgentFarm(ctx);
const {
  buildAgentOutputs, buildEvents, resolvePipelineEvents, mem,
  buildAnalystOutputPayload, buildAnalystPrerequisitePayload,
  validateAnalystOutputLive, validateTestDataExtractorOutput,
  resolveLiveValidatorReturn, validationGateEvents, buildOrchestratorInactivityFailureEvents,
  buildValidatorLiveState, buildFeedbackLoops, buildOrchestratorLiveState, enrichEventForDisplay,
  buildPrerequisiteInputEvents, buildHumanInputEvents,
  buildEventsAfterHumanPrerequisites, buildEventsAfterHumanApiInput,
  assertCanAssign, deriveValidatedRolesFromEvents,
  buildTestExecutorOutput, buildReviewerOutput, reviewHumanInputAgainstAnalyst,
  buildReporterOutput, buildTestDataExtractorOutput, buildAuthorOutput,
} = farm;

// ctx helpers wired after function declarations (hoisted)
Object.assign(ctx, {
  getProvidedPrerequisites,
  isPrerequisitesSatisfied,
  getPrerequisiteCheck,
  getLiveHumanInputNeed,
  isHumanInputSatisfied,
  storyRequiresApi,
  storyRequiresWebpage,
  isRequiredInputReady,
});

const buildHumanApiEvents = buildHumanInputEvents;

async function apiFetch(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}


function browseUrlForKey(key) {
  const current = getJiraInput();
  const baseMatch = current.match(/^(https?:\/\/[^/]+)/i);
  const base = baseMatch ? baseMatch[1] : "https://leansa.atlassian.net";
  return `${base.replace(/\/$/, "")}/browse/${key}`;
}


function buildRunLogExport() {
  const story = currentStory;
  const exportedAt = new Date().toISOString();
  const lastReached = idx >= 0 ? idx : -1;
  const source = story?.from_jira ? "jira" : story?.from_requirements ? "requirements" : "mock";
  const lines = [];

  lines.push("================================================================================");
  lines.push("QA AGENT FARM — RUN LOG");
  lines.push("================================================================================");
  lines.push(`Exported at  : ${exportedAt}`);
  lines.push(`Story ID     : ${story?.id || "—"}`);
  lines.push(`Title        : ${story?.title || "—"}`);
  lines.push(`Source       : ${source}`);
  lines.push(`Progress     : ${lastReached >= 0 ? `step ${lastReached + 1} / ${EVENTS.length}` : "not started"}`);
  if (story?.acceptance_criteria_list?.length) {
    lines.push("Acceptance criteria:");
    story.acceptance_criteria_list.forEach((ac, i) => lines.push(`  AC-${i + 1}: ${ac}`));
  }
  lines.push("");

  const prereqs = getProvidedPrerequisites();
  if (prereqs.length) {
    lines.push("--- HUMAN: PREREQUISITES PROVIDED ---");
    prereqs.forEach((p) => lines.push(`  ${p.label}: ${p.value}`));
    lines.push("");
  }

  const humanNeed = story ? getLiveHumanInputNeed(story) : null;
  if (humanApiInput.ok) {
    lines.push("--- HUMAN: API CURL PROVIDED ---");
    const safe = redactParsedCurl(humanApiInput);
    lines.push(`  ${safe.method} ${safe.url}`);
    lines.push("");
  }
  if (humanWebpageInput.ok) {
    lines.push("--- HUMAN: WEBPAGE PROVIDED ---");
    lines.push(`  ${humanWebpageInput.url}${humanWebpageInput.title ? ` (${humanWebpageInput.title})` : ""}`);
    lines.push("");
  }
  if (humanNeed?.needsHumanInput && !isHumanInputSatisfied(humanNeed)) {
    lines.push("--- HUMAN: EXECUTION INPUT STILL REQUIRED ---");
    lines.push(`  ${humanNeed.action || humanNeed.reason || humanNeed.types.join(", ")}`);
    lines.push("");
  }

  lines.push("--- EVENT TIMELINE ---");
  lines.push("");

  EVENTS.forEach((rawEv, i) => {
    const ev = enrichEventForDisplay(rawEv);
    const step = String(i + 1).padStart(3, "0");
    const actor = ev.role || ev.target_agent || "orchestrator";
    let marker = "";
    if (i === idx) marker = "  ← CURRENT STEP";
    else if (lastReached >= 0 && i > lastReached) marker = "  (not reached yet)";

    lines.push(`[${step}] ${ev.kind} | phase=${ev.phase} | actor=${actor}${marker}`);
    if (ev.message) lines.push(`      MESSAGE  : ${ev.message}`);
    if (ev.decision) lines.push(`      DECISION : ${ev.decision}`);
    if (ev.output_note) lines.push(`      NOTE     : ${ev.output_note}`);
    if (ev.orchestrator_memory && Object.keys(ev.orchestrator_memory).length) {
      lines.push(`      MEMORY   : ${Object.entries(ev.orchestrator_memory).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    if (ev.validation?.passed === false || ev.passed === false) {
      const failures = ev.validation?.failures || ev.validation_feedback?.failures || [];
      if (failures.length) lines.push(`      FAILURES : ${failures.join(" · ")}`);
    }
    if (ev.passed === true || ev.validation?.passed === true) {
      lines.push(`      RESULT   : PASS`);
    } else if (ev.passed === false || ev.validation?.passed === false) {
      lines.push(`      RESULT   : FAIL`);
    }
    if (ev.agent_returns && Object.keys(ev.agent_returns).length) {
      lines.push(`      RETURNS  : ${formatLogObject(ev.agent_returns, "               ")}`);
    }
    if (ev.prerequisite_need?.items?.length) {
      lines.push(`      PREREQ GAPS: ${ev.prerequisite_need.items.map((x) => x.label).join(", ")}`);
    }
    if (ev.human_input_need?.types?.length) {
      lines.push(`      INPUT NEED : ${ev.human_input_need.types.join(" + ")} — ${ev.human_input_need.reason || ""}`);
    }
    lines.push("");
  });

  lines.push("================================================================================");
  lines.push(`END OF LOG — ${EVENTS.length} events`);
  lines.push("================================================================================");

  const jsonl = EVENTS.map((ev, i) => JSON.stringify({
    step: i + 1,
    current: i === idx,
    reached: lastReached < 0 ? false : i <= lastReached,
    ...ev,
  }));

  const snapshot = {
    exported_at: exportedAt,
    story: story ? {
      id: story.id,
      title: story.title,
      source,
      acceptance_criteria: story.acceptance_criteria_list,
    } : null,
    progress: { current_step: idx + 1, total_steps: EVENTS.length, last_reached: lastReached + 1 },
    human: {
      prerequisites: getProvidedPrerequisites(),
      api: humanApiInput.ok ? { method: humanApiInput.method, url: humanApiInput.url, endpoint: humanApiInput.endpoint } : null,
      webpage: humanWebpageInput.ok ? { url: humanWebpageInput.url, title: humanWebpageInput.title } : null,
    },
    agent_outputs: storyOutputs,
    events: EVENTS,
  };

  return { text: lines.join("\n"), jsonl: jsonl.join("\n") + "\n", snapshot };
}


function buildStoryFromRequirementsForm() {
  const parsed = parseRequirementsDescription(el("req-description")?.value || "");
  const {
    title,
    description,
    requirements_raw,
    acceptance_criteria_list: acList,
    acceptance_criteria_entries: acEntries,
    acceptance_criteria_rejected: rejectedAcs,
    requirements_metadata: meta,
  } = parsed;

  const id = `REQ-${Date.now().toString(36).toUpperCase()}`;
  // Never invent placeholder TCs when zero ACs were parsed — that caused false-complete runs.
  const tcCount = acList.length;
  const test_cases = Array.from({ length: tcCount }, (_, i) =>
    `TC-${String(i + 1).padStart(2, "0")}`
  );

  return {
    id,
    title,
    jira: null,
    description,
    requirements_raw,
    requirements_metadata: meta || {},
    acceptance_criteria_list: acList,
    acceptance_criteria_entries: acEntries || acList.map((text) => ({ text, source: "Business Rules", section: "inferred_business_rules" })),
    acceptance_criteria_rejected: rejectedAcs || [],
    priority: meta?.priority || "Medium",
    status: meta?.status || "Draft",
    issueType: meta?.issueType || meta?.type || "Requirement",
    components: meta?.components || [],
    labels: meta?.labels || [],
    acceptance_criteria: acList.length,
    gaps: Math.max(1, acList.length + 1),
    blocking_gaps: 0,
    test_cases,
    api_requests: 0,
    score: "—",
    passed: 0,
    failed: 0,
    coverage: 0,
    from_jira: false,
    from_requirements: true,
    fetched_at: new Date().toISOString(),
  };
}


async function checkJiraHealth() {
  if (location.protocol === "file:") {
    setJiraStatus("err", "use server");
    el("server-banner").hidden = false;
    return false;
  }
  try {
    const health = await apiFetch("/api/jira/health");
    jiraConfigured = health.configured;
    setJiraStatus(health.configured ? "ok" : "err", health.configured ? "JIRA connected" : "no credentials");
    return health.configured;
  } catch {
    setJiraStatus("err", "server offline");
    el("server-banner").hidden = false;
    return false;
  }
}


function clearOrchestratorInactivityTimer() {
  if (orchestratorInactivityTimer) clearTimeout(orchestratorInactivityTimer);
  if (orchestratorInactivityCountdownInterval) clearInterval(orchestratorInactivityCountdownInterval);
  orchestratorInactivityTimer = null;
  orchestratorInactivityCountdownInterval = null;
  orchestratorInactivityDeadline = null;
  updateOrchestratorInactivityCountdownUI();
}


async function downloadReport(triggerBtn) {
  const report = getReportData();
  if (!report) {
    alert("Report is not ready yet. Run the pipeline until the Reporter step completes.");
    return;
  }
  if (typeof buildReportDocxBlob !== "function") {
    alert("Report export module not loaded.");
    return;
  }
  const btn = triggerBtn || el("btn-download-report");
  const defaultHtml = btn?.classList?.contains("btn-report-download-inline")
    ? '<i class="ti ti-download"></i> Download report'
    : '<i class="ti ti-download"></i>';
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = btn.classList.contains("btn-report-download-inline")
        ? '<i class="ti ti-loader spin"></i> Exporting…'
        : '<i class="ti ti-loader spin"></i>';
    }
    const blob = await buildReportDocxBlob(report);
    const id = sanitizeLogFilename(currentStory?.id || report.ticket_key || "report");
    const ts = logTimestamp();
    triggerFileDownload(
      `test-summary-${id}-${ts}.docx`,
      blob,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    triggerFileDownload(
      `test-summary-${id}-${ts}.json`,
      JSON.stringify(report, null, 2),
      "application/json;charset=utf-8",
    );
  } catch (err) {
    alert("Could not export report: " + err.message);
  } finally {
    if (btn) btn.innerHTML = defaultHtml;
    updateReportHeaderButtons();
    document.querySelectorAll(".btn-report-download-inline").forEach((b) => { b.disabled = false; });
  }
}


function downloadRunLog() {
  if (!currentStory || !EVENTS.length) {
    alert("Load a story first (JIRA ticket or Requirements tab), then download the log.");
    return;
  }
  const { text, jsonl, snapshot } = buildRunLogExport();
  const id = sanitizeLogFilename(currentStory.id);
  const ts = logTimestamp();
  triggerFileDownload(`qa-run-${id}-${ts}.log`, text, "text/plain;charset=utf-8");
  triggerFileDownload(`qa-run-${id}-${ts}.jsonl`, jsonl, "application/x-ndjson;charset=utf-8");
  triggerFileDownload(`qa-run-${id}-${ts}.json`, JSON.stringify(snapshot, null, 2), "application/json;charset=utf-8");
}


function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


async function fetchJiraTicket(input) {
  const resolved = resolveTicketInput(input);
  if (!resolved) throw new Error("Paste a valid JIRA URL (e.g. https://…/browse/SEHJ-10668)");
  const { key, url } = resolved;
  el("jira-url").value = url;
  setJiraStatus("loading", "fetching " + key + "…");
  const issue = await apiFetch("/api/jira/issue?url=" + encodeURIComponent(url));
  return issueToStory(issue);
}


function fillRequirementsForm(story) {
  if (!story || !el("req-description")) return;
  el("req-description").value = story.requirements_raw
    || [story.title, story.description !== story.title ? story.description : "", story.acceptance_criteria_list?.length ? "\nAcceptance Criteria:\n" + story.acceptance_criteria_list.map((ac) => `- ${ac}`).join("\n") : ""].filter(Boolean).join("\n");
}


function findDataExtractorGateSlice() {
  const start = EVENTS.findIndex((e) => e.kind === "validator_assign" && e.target_agent === "test_data_extractor");
  if (start < 0) return null;
  let end = start;
  for (let i = start; i < EVENTS.length; i++) {
    if (EVENTS[i].kind === "orchestrator_gate" && EVENTS[i].target_agent === "test_data_extractor") {
      end = i + 1;
      break;
    }
    if (EVENTS[i].kind === "run_failed" || (EVENTS[i].kind === "orchestrator_abort" && EVENTS[i].target_agent === "test_data_extractor")) {
      end = i + 1;
      break;
    }
  }
  return end > start ? { start, end } : null;
}


function findHumanInputEventSlice() {
  const start = EVENTS.findIndex((e) => e.kind === "human_input_request");
  if (start < 0) return null;
  let end = start;
  for (let i = start; i < EVENTS.length; i++) {
    if (EVENTS[i].kind === "orchestrator_instruct" && EVENTS[i].target_agent === "test_data_extractor") {
      end = i + 1;
      break;
    }
  }
  return end > start ? { start, end } : null;
}


function focusReportTabIfReady() {
  if (agentStatuses.reporter !== "done") return;
  activeOutputTab = "reporter";
}


function formatCountdown(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}


function formatLogObject(obj, baseIndent) {
  if (obj == null || (typeof obj === "object" && !Object.keys(obj).length)) return "—";
  return JSON.stringify(obj, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : baseIndent + line))
    .join("\n");
}


function getDoneRolesUpTo(i) {
  const done = new Set();
  if (i >= 0) done.add("orchestrator");
  for (let j = 0; j <= i; j++) {
    const rawEv = EVENTS[j];
    const ev = rawEv?.kind === "validator_return" ? resolveLiveValidatorReturn(rawEv) : rawEv;
    if (ev?.kind === "agent_return" && ev.role && ev.structured_output) done.add(ev.role);
    if (ev?.kind === "validator_return" && ev.passed) done.add("validator");
  }
  return done;
}


function getJiraInput() {
  return (el("jira-url")?.value || "").trim();
}


function getLiveHumanInputNeed(story) {
  return inferHumanInputNeeds(story, storyOutputs?.analyst, storyOutputs?.writer?.test_cases);
}


function getPrerequisiteCheck(story) {
  const pn = storyOutputs?.analyst?.prerequisites_needed;
  if (pn?.items?.length || pn?.story_analysis) return pn;
  if (!story) return { needed: false, items: [], summary: "No prerequisites detected" };
  return buildAnalystPrerequisitePayload(story);
}


function getProvidedPrerequisites() {
  // Use the already-computed check when available. Never call getPrerequisiteCheck()
  // here: it rebuilds the analyst prerequisite payload, which (via
  // buildAccessPrerequisiteItems → inferHumanInputNeeds → buildRequirementsFromStory)
  // calls back into getProvidedPrerequisites and recurses infinitely.
  const items = cachedPrerequisiteCheck?.items;
  if (items?.length) {
    return items
      .map((item) => ({
        id: item.id,
        label: item.label,
        value: (userPrerequisites[item.id]?.value || "").trim(),
        reason: item.reason,
      }))
      .filter((p) => p.value);
  }
  // Fallback (no check computed yet): read straight from stored user inputs.
  return Object.entries(userPrerequisites)
    .map(([id, entry]) => ({
      id,
      label: entry?.label || id,
      value: (entry?.value || "").trim(),
      reason: entry?.reason,
    }))
    .filter((p) => p.value);
}


function getReportData() {
  if (!currentStory || !storyOutputs?.reporter) return null;
  const report = JSON.parse(JSON.stringify(storyOutputs.reporter));
  const executor = storyOutputs.test_executor;
  const reviewer = storyOutputs.reviewer;
  if (executor?.summary) {
    report.summary = { ...report.summary, ...executor.summary };
  }
  if (executor?.results?.length) {
    report.regression_rows = (report.regression_rows || []).map((row) => {
      const result = executor.results.find((r) => r.test_case_id === row.id);
      return result ? { ...row, status: result.status, evidence: result.evidence } : row;
    });
  }
  if (reviewer?.score) report.qa_score = reviewer.score;
  if (reviewer?.impact) report.qa_impact = reviewer.impact;
  report.generated_at = new Date().toISOString();
  report.story_source = currentStory.from_jira ? "jira" : currentStory.from_requirements ? "requirements" : "mock";
  report.story_title = currentStory.title || report.ticket_title;
  report.ticket_url = currentStory.jira
    || (currentStory.from_jira && currentStory.id ? browseUrlForKey(currentStory.id) : null);
  report.acceptance_criteria = currentStory.acceptance_criteria_list || [];
  report.version_info = [
    currentStory.id,
    ...(currentStory.components || []),
  ].filter(Boolean).join(" | ") || "—";
  report.release_no = currentStory.title || report.ticket_title;
  report.out_of_scope = storyOutputs?.reviewer?.missing_coverage || [];
  report.items_not_tested = (storyOutputs?.analyst?.coverage_gaps || []).map((g) =>
    typeof g === "string" ? g : `[${g.severity || "non-blocking"}] ${g.gap}`
  );
  const sum = report.summary || {};
  report.regression_status = (sum.executed ?? 0) > 0 && (sum.failed ?? 0) === 0
    ? "Completed"
    : (sum.executed ?? 0) > 0
      ? "In Progress"
      : "Planned";
  report.pipeline_progress = {
    current_step: idx + 1,
    total_steps: EVENTS.length,
    reporter_reached: agentStatuses.reporter === "done",
  };
  return report;
}


function handleOrchestratorInactivityTimeout() {
  if (!currentStory || !isBlockingOrchestratorWait(idx)) return;
  clearOrchestratorInactivityTimer();
  stopPlay();
  const timeoutEvents = buildOrchestratorInactivityFailureEvents(currentStory);
  EVENTS = EVENTS.slice(0, idx + 1).concat(timeoutEvents);
  el("step-total").textContent = EVENTS.length;
  setHumanInputStatus("err", `run failed — no ${waitingForHumanInputDescription(getLiveHumanInputNeed(currentStory))} for 1 min`);
  showEvent(idx + 1);
}


function initAgentOutputState() {
  agentOutputs = {};
  agentStatuses = {};
  OUTPUT_ROLES.forEach((r) => {
    agentStatuses[r] = "pending";
  });
  renderOutputTabs();
  renderActiveOutputTab();
}


function isBlockingOrchestratorWait(eventIndex) {
  const need = getLiveHumanInputNeed(currentStory);
  if (!need.needsHumanInput || isHumanInputSatisfied(need)) return false;
  const e = EVENTS[eventIndex];
  return e?.kind === "human_input_request";
}


function isExecutionPhaseBlocked(eventIndex) {
  const ev = EVENTS[eventIndex];
  if (!ev || !currentStory) return false;
  if (isRequiredInputReady(currentStory)) return false;
  return ev.phase === "test_data_extraction"
    || ev.phase === "test_execution"
    || ev.kind === "run_end";
}


function isHumanInputSatisfied(need) {
  if (!need?.needsHumanInput) return true;
  if (need.types.includes("api") && !humanApiInput.ok) return false;
  if (need.types.includes("webpage") && !humanWebpageInput.ok) return false;
  return true;
}


function actionNeedsTypedValue(a) {
  if (!a) return false;
  if (a.requires_value === true) return true;
  const detail = String(a.detail || "");
  return a.action === "ASK_HUMAN"
    || a.action === "FETCH_DEPENDENCY"
    || /\b(provide|supply|seed|url|credential|password|token|curl|confirm|clarif)\b/i.test(detail);
}

function isPrerequisitesSatisfied() {
  // Checkbox alone is not enough when Analyst asked for a typed clarification / value.
  const actionsOk = !blockingOrchestratorActions.length
    || blockingOrchestratorActions.every((a) => {
      const value = (a.provided_value || "").trim();
      if (actionNeedsTypedValue(a)) return value.length > 0;
      return !!a.resolved || value.length > 0;
    });
  // When the panel surfaces the curl/webpage fields, the human must fill them here.
  const apiOk = !prereqShowsApi || humanApiInput.ok;
  const webOk = !prereqShowsWeb || humanWebpageInput.ok;
  const check = cachedPrerequisiteCheck;
  if (!check?.items?.length) return actionsOk && apiOk && webOk;
  const fieldsOk = check.items.every((item) => {
    // Access items are validated via the parsed curl / webpage inputs, not free text.
    if (item.input_type === "api_curl") return humanApiInput.ok;
    if (item.input_type === "webpage_url") return humanWebpageInput.ok;
    const v = userPrerequisites[item.id]?.value;
    return v != null && String(v).trim().length > 0;
  });
  return actionsOk && fieldsOk && apiOk && webOk;
}


function isRequiredInputReady(story) {
  if (!story) return false;
  const prereq = getPrerequisiteCheck(story);
  if (prereq.needed && !isPrerequisitesSatisfied()) return false;
  const humanNeed = getLiveHumanInputNeed(story);
  if (humanNeed.needsHumanInput && !isHumanInputSatisfied(humanNeed)) return false;
  return true;
}


function isWaitingForHumanInput(eventIndex) {
  const need = getLiveHumanInputNeed(currentStory);
  if (!need.needsHumanInput || isHumanInputSatisfied(need)) return false;
  const e = EVENTS[eventIndex];
  return e?.kind === "human_input_request" || e?.kind === "human_input_received";
}


function isWaitingForPrerequisites(eventIndex) {
  const e = EVENTS[eventIndex];
  if (e?.kind !== "prerequisite_input_request") return false;
  const check = e.prerequisite_need || getPrerequisiteCheck(currentStory);
  return check.needed && !isPrerequisitesSatisfied();
}


function kindClass(kind) {
  if (kind === "orchestrator_instruct" || kind === "orchestrator_reinstruct" || kind === "human_input_request" || kind === "human_input_received" || kind === "prerequisite_input_request" || kind === "prerequisite_input_received" || kind.includes("assign")) return "assign";
  if (kind === "orchestrator_receive" || kind.includes("return")) return kind === "validator_return" ? "validate" : "return";
  if (kind === "validator_assign") return "validate";
  if (kind === "validator_brake" || kind === "run_failed" || kind === "orchestrator_abort" || kind === "orchestrator_inactivity_timeout" || kind === "pipeline_hold") return "abort";
  if (kind.includes("decision") || kind.includes("validate") || kind === "orchestrator_stage" || kind === "orchestrator_gate") return "decision";
  if (kind.includes("end")) return "end";
  return "phase";
}


function kindLabel(kind) {
  const map = {
    run_start: "Run start",
    orchestrator_stage: "Orchestrator · stage 1",
    orchestrator_instruct: "Instruct → agent",
    orchestrator_reinstruct: "Re-instruct (validator feedback)",
    orchestrator_receive: "← Agent feedback",
    orchestrator_gate: "Gate · validation passed",
    validator_brake: "Validator · brake (2 strikes)",
    orchestrator_abort: "Orchestrator · run halted",
    validator_assign: "Validator · checking",
    validator_return: "Validator · result",
    iteration_start: "New iteration",
    phase_start: "Phase",
    orchestrator_validate: "Validation",
    agent_assign: "Assign → agent",
    agent_return: "← Agent result",
    orchestrator_decision: "Decision",
    run_failed: "Run failed",
    human_input_request: "Human input · required",
    prerequisite_input_request: "Prerequisites · human input required",
    prerequisite_input_received: "Prerequisites · received",
    pipeline_hold: "Pipeline hold · upstream not validated",
    orchestrator_inactivity_timeout: "Orchestrator · inactivity timeout",
    human_input_received: "Human input · received",
    run_end: "Run end",
  };
  return map[kind] || kind;
}


function shouldSkipAgent1(runOptions) {
  // Skip live Agent 1 only for the Requirements failures demo (scripted incomplete path).
  return (runOptions || currentRunOptions)?.demo === "requirements";
}

/**
 * Live Agent 1 (Cursor Agent · Sonnet 5) is OFF by default so the simulator
 * runs end-to-end with no cursor-agent login. Turn it on with either
 * `?agent1=live` in the URL or localStorage.setItem("qa-live-agent1","1").
 */
function isLiveAgent1Enabled() {
  try {
    const url = new URL(location.href);
    const q = url.searchParams.get("agent1");
    if (q === "live") return true;
    if (q === "local") return false;
    return localStorage.getItem("qa-live-agent1") === "1";
  } catch {
    return false;
  }
}

function ticketTextForAnalyst(story) {
  if (!story) return "";
  if (story.requirements_raw) return String(story.requirements_raw);
  const parts = [
    story.title ? `Title: ${story.title}` : "",
    story.description || "",
    (story.acceptance_criteria_list || []).length
      ? "Acceptance Criteria:\n" + story.acceptance_criteria_list.map((a, i) => `- AC-${i + 1}: ${a}`).join("\n")
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

async function runAgent1(story) {
  const ticketText = ticketTextForAnalyst(story);
  if (!ticketText.trim()) throw new Error("No ticket text for Agent 1");
  if (location.protocol === "file:") {
    throw new Error("Agent 1 needs the local server (npm start) — file:// cannot call Cursor Agent");
  }

  const statusTarget = currentInputSource === "jira" ? setJiraStatus : setRequirementsLoadStatus;
  statusTarget("loading", "Agent 1 running via Cursor Agent (Sonnet 5)… (~1–2 min)");
  el("event-message").textContent = "Agent 1 (Requirement Analyst) is analyzing the ticket via Cursor Agent · Sonnet 5…";
  el("status-orchestrator").textContent = "awaiting Agent 1";
  if (el("status-analyst")) el("status-analyst").textContent = "running…";

  const res = await fetch("/api/agents/analyst", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketText }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.message || `Agent 1 failed (HTTP ${res.status})`);
  }

  const scratchpad = data.scratchpad;
  const parsed = data.parsed || data;
  story.live_analyst_output = {
    ...parsed,
    scratchpad: typeof scratchpad === "string" ? scratchpad : (scratchpad?.rendered || scratchpad),
    runner: "cursor_agent_cli",
    model: "claude-sonnet-5 (high)",
    success: true,
  };
  if (el("status-analyst")) el("status-analyst").textContent = "done";
  return story.live_analyst_output;
}

/**
 * Ensure Agent 1 analysis is available. Default path is the local
 * deterministic analyst (no network, instant). When live Agent 1 is enabled,
 * call the Cursor Agent CLI and gracefully fall back to local on any failure.
 */
async function ensureAgent1(story, runOptions) {
  if (!story || shouldSkipAgent1(runOptions)) return story;
  if (story.live_analyst_output) return story;
  if (!isLiveAgent1Enabled()) return story; // local deterministic analyst
  try {
    await runAgent1(story);
  } catch (err) {
    console.warn("Live Agent 1 failed; falling back to local analyst:", err?.message || err);
    if (el("status-analyst")) el("status-analyst").textContent = "local";
    const statusTarget = currentInputSource === "jira" ? setJiraStatus : setRequirementsLoadStatus;
    statusTarget("ok", "live Agent 1 unavailable — using local analyst");
  }
  return story;
}

async function loadRequirementsFromForm(runOptions) {
  const story = buildStoryFromRequirementsForm();
  try {
    const raw = el("req-description")?.value || "";
    if (raw.trim()) sessionStorage.setItem("qa-last-requirements", raw);
  } catch { /* ignore */ }

  await ensureAgent1(story, runOptions);
  setRequirementsLoadStatus(
    "ok",
    story.live_analyst_output ? "Agent 1 done · " + story.id : "loaded " + story.id,
  );

  loadStory(story, runOptions);
  el("event-message").textContent = story.live_analyst_output
    ? "Agent 1 complete (Cursor Agent · Sonnet 5) — press Play. Pipeline pauses on WAITING_ON_HUMAN when actions are blocking."
    : "Requirements loaded — press Play to start the QA pipeline.";
  activeOutputTab = "analyst";
  renderOutputTabs();
  renderActiveOutputTab();
  return story;
}


async function loadSampleRequirements(runOptions, autoRun) {
  const sample = typeof LOGIN_USE_CASE_SAMPLE === "string" ? LOGIN_USE_CASE_SAMPLE : "";
  if (!sample || !el("req-description")) return null;
  setInputSource("requirements");
  el("req-description").value = sample;
  setRequirementsLoadStatus("ok", "sample loaded");
  const story = await loadRequirementsFromForm(runOptions);
  if (autoRun) {
    el("event-message").textContent = "Login use case sample loaded — press Play.";
  }
  return story;
}


function loadStory(story, runOptions) {
  if (!story) return;
  stopPlay();
  reset();
  currentStory = story;
  const opts = runOptions || currentRunOptions || {};
  currentRunOptions = opts;
  storyOutputs = buildAgentOutputs(story);
  EVENTS = resolvePipelineEvents(story, opts);
  initAgentOutputState();
  // Seed Analyst (and any precomputed) outputs so humans can open tabs before Play.
  if (storyOutputs?.analyst) {
    publishAgentOutputForHuman("analyst", storyOutputs.analyst, story.live_analyst_output ? "done" : "pending");
  }
  if (storyOutputs?.orchestrator) {
    publishAgentOutputForHuman("orchestrator", storyOutputs.orchestrator, "pending");
  }
  updateDemoBanner(opts);
  humanApiInput = { ok: false, curl: "", base_url: "", endpoint: "", method: "GET", url: "", headers: {}, auth: "", body: null };
  humanWebpageInput = { ok: false, url: "", path: "", origin: "", title: "" };
  executionResult = null;
  userPrerequisites = {};
  cachedPrerequisiteCheck = null;
  cachedHumanInputNeed = null;
  pipelineState = "RUNNING";
  blockingOrchestratorActions = [];
  if (storyOutputs?.analyst?.pipeline_state) {
    pipelineState = storyOutputs.analyst.pipeline_state;
  }
  if (el("human-api-curl")) el("human-api-curl").value = "";
  if (el("human-web-url")) el("human-web-url").value = "";
  if (el("human-web-title")) el("human-web-title").value = "";
  renderCurlPreview(null);
  renderWebPreview(null);
  el("prerequisites-panel") && (el("prerequisites-panel").hidden = true);
  el("human-input-panel") && (el("human-input-panel").hidden = true);
  cachedHumanInputNeed = getLiveHumanInputNeed(story);
  el("story-title").textContent = story.title;
  const runId = (story.fetched_at || new Date().toISOString()).replace(/[-:]/g, "").slice(0, 15) + "Z";
  const source = story.from_jira ? "live JIRA" : story.from_requirements ? "requirements" : "mock";
  const modeLabel = opts.demo === "requirements"
    ? ' · <span style="color:#dc2626;font-weight:600">demo: requirements failures</span>'
    : "";
  el("story-meta").innerHTML = story.id + " · " + source + modeLabel + " · run <span id=\"run-id\">" + runId + "</span>";
  if (story.from_requirements) {
    fillRequirementsForm(story);
    setInputSource("requirements");
  } else if (story.jira) {
    el("jira-url").value = story.jira;
    setInputSource("jira");
  }
  el("step-total").textContent = EVENTS.length;
  renderTicketPanel(story);
  renderPipelineBar(null, new Set());
  document.title = "QA Agent Farm · " + story.id;
  if (jiraConfigured) setJiraStatus("ok", "JIRA connected");
}


async function loadStoryByKey(input, preferJira, runOptions) {
  const resolved = resolveTicketInput(input);
  if (!resolved) return;

  el("jira-url").value = resolved.url;
  if (preferJira && location.protocol !== "file:") {
    try {
      const story = await fetchJiraTicket(resolved.url);
      await ensureAgent1(story, runOptions);
      loadStory(story, runOptions);
      setJiraStatus("ok", "loaded " + resolved.key + (story.live_analyst_output ? " · Agent 1 done" : ""));
      activeOutputTab = "analyst";
      renderOutputTabs();
      renderActiveOutputTab();
      return;
    } catch (err) {
      setJiraStatus("err", err.message.slice(0, 40));
    }
  }

  const fallback = FALLBACK_STORIES[resolved.key];
  if (fallback) {
    try {
      const story = { ...fallback };
      await ensureAgent1(story, runOptions);
      loadStory(story, runOptions);
      if (!preferJira) setJiraStatus("err", "mock data");
      activeOutputTab = "analyst";
      renderOutputTabs();
      renderActiveOutputTab();
    } catch (err) {
      setJiraStatus("err", err.message.slice(0, 40));
      alert(err.message);
    }
  } else {
    el("event-message").textContent = "Could not load " + resolved.key + ". Check the JIRA URL and server.";
  }
}

el("btn-next").onclick = () => { stopPlay(); next(); };
el("btn-prev").onclick = () => { stopPlay(); prev(); };
el("btn-reset").onclick = reset;
el("btn-download-log")?.addEventListener("click", downloadRunLog);
el("btn-view-report")?.addEventListener("click", viewReport);
el("btn-download-report")?.addEventListener("click", () => downloadReport(el("btn-download-report")));
el("output-body")?.addEventListener("click", (e) => {
  const dl = e.target.closest(".btn-report-download-inline");
  if (dl) downloadReport(dl);
});
el("btn-play").onclick = () => { playing ? stopPlay() : startPlay(); };
el("speed").oninput = () => {
  el("speed-val").textContent = (el("speed").value / 1000).toFixed(1) + "s";
  if (playing) { stopPlay(); startPlay(); }
};
el("btn-fetch-jira").onclick = async () => {
  const btn = el("btn-fetch-jira");
  if (btn) btn.disabled = true;
  try {
    const story = await fetchJiraTicket();
    setInputSource("jira");
    await ensureAgent1(story, currentRunOptions);
    loadStory(story, currentRunOptions);
    setJiraStatus("ok", "loaded " + story.id + (story.live_analyst_output ? " · Agent 1 done" : ""));
    activeOutputTab = "analyst";
    renderOutputTabs();
    renderActiveOutputTab();
  } catch (err) {
    setJiraStatus("err", err.message.slice(0, 48));
    alert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
};
el("btn-load-requirements")?.addEventListener("click", async () => {
  const btn = el("btn-load-requirements");
  if (btn) btn.disabled = true;
  try {
    await loadRequirementsFromForm(currentRunOptions);
  } catch (err) {
    setRequirementsLoadStatus("err", err.message);
    alert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});
el("btn-load-sample-requirements")?.addEventListener("click", async () => {
  const btn = el("btn-load-sample-requirements");
  if (btn) btn.disabled = true;
  try {
    await loadSampleRequirements(currentRunOptions, false);
  } catch (err) {
    setRequirementsLoadStatus("err", err.message);
    alert(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});
el("tab-source-jira")?.addEventListener("click", () => setInputSource("jira"));
el("tab-source-requirements")?.addEventListener("click", () => setInputSource("requirements"));
el("jira-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("btn-fetch-jira").click();
});

document.querySelectorAll(".output-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activeOutputTab = tab.dataset.agent;
    renderOutputTabs();
    renderActiveOutputTab();
  });
});

el("btn-submit-human-input")?.addEventListener("click", () => submitHumanInput(true));
el("btn-submit-prerequisites")?.addEventListener("click", submitPrerequisites);
el("human-api-curl")?.addEventListener("input", () => {
  const need = getLiveHumanInputNeed(currentStory);
  if (!need.types.includes("api")) return;
  const parsed = parseCurl(el("human-api-curl").value);
  renderCurlPreview(parsed.ok ? parsed : null);
  if (parsed.ok) setHumanInputStatus("loading", "curl parsed — click Provide input to confirm");
});
el("human-web-url")?.addEventListener("input", () => {
  const need = getLiveHumanInputNeed(currentStory);
  if (!need.types.includes("webpage")) return;
  const parsed = parseWebpageInput(el("human-web-url").value, el("human-web-title")?.value);
  renderWebPreview(parsed.ok ? parsed : null);
  if (parsed.ok) setHumanInputStatus("loading", "webpage parsed — click Provide input to confirm");
});
el("human-web-title")?.addEventListener("input", () => {
  const need = getLiveHumanInputNeed(currentStory);
  if (!need.types.includes("webpage")) return;
  const parsed = parseWebpageInput(el("human-web-url")?.value, el("human-web-title").value);
  renderWebPreview(parsed.ok ? parsed : null);
});


function logTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
}


function dependencyAssignContext() {
  const need = currentStory ? getLiveHumanInputNeed(currentStory) : { needsHumanInput: false };
  const recheck = storyOutputs?.reviewer?.human_input_recheck;
  const hadPrereqRequest = EVENTS.some((e) => e?.kind === "prerequisite_input_request");
  return {
    storyOutputs: storyOutputs || {},
    validatedRoles: deriveValidatedRolesFromEvents(EVENTS, idx),
    pipelineState,
    requireHumanRecheck: hadPrereqRequest && pipelineState !== "READY_FOR_WRITER",
    humanInputRecheckPassed: recheck?.passed === true || (!hadPrereqRequest && pipelineState === "READY_FOR_WRITER"),
    needsHumanInput: !!need.needsHumanInput,
    humanInputSatisfied: currentStory ? isHumanInputSatisfied(need) : true,
  };
}

function next() {
  if (isWaitingForPrerequisites(idx)) {
    stopPlay();
    promptForPrerequisites();
    return;
  }
  if (isWaitingForHumanInput(idx)) {
    stopPlay();
    const need = getLiveHumanInputNeed(currentStory);
    updateHumanInputPanel(currentStory, { forceShow: true, humanInputNeed: need });
    setHumanInputStatus("err", need.action || `complete ${humanInputTypeLabel(need.types)} in sidebar`);
    el("human-input-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  if (idx < EVENTS.length - 1 && isExecutionPhaseBlocked(idx + 1)) {
    stopPlay();
    promptForRequiredInput();
    return;
  }
  const nextEv = idx < EVENTS.length - 1 ? EVENTS[idx + 1] : null;
  if (nextEv?.kind === "agent_assign" && nextEv.role) {
    const gate = assertCanAssign(nextEv.role, dependencyAssignContext());
    if (!gate.ok) {
      stopPlay();
      if (el("event-message")) el("event-message").textContent = gate.blocked_reason;
      return;
    }
  }
  if (idx < EVENTS.length - 1) showEvent(idx + 1);
  else {
    stopPlay();
    focusReportTabIfReady();
    renderOutputTabs();
    renderActiveOutputTab();
  }
}


function parseIssueKey(input) {
  if (!input) return null;
  const s = String(input).trim();
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      const browse = u.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
      if (browse) return browse[1].toUpperCase();
      const selected = u.searchParams.get("selectedIssue");
      if (selected) {
        const fromQuery = selected.match(/([A-Z][A-Z0-9]+-\d+)/i);
        if (fromQuery) return fromQuery[1].toUpperCase();
      }
    }
  } catch {
    /* not a valid URL */
  }
  const m = s.match(/([A-Z][A-Z0-9]+-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}


function prev() {
  if (idx > 0) showEvent(idx - 1);
  else if (EVENTS.length) showEvent(0);
}


function promptForPrerequisites() {
  updatePrerequisitesPanel(currentStory, { forceShow: true });
  el("prerequisites-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  updatePrerequisiteStatus();
  const status = el("prerequisites-status");
  if (status && !isPrerequisitesSatisfied()) {
    status.className = "jira-status err";
    status.textContent = "Orchestrator paused — provide analyst-identified prerequisites";
  }
  el("event-message").textContent =
    "Orchestrator assigned the analyst; validator approved prerequisites but human setup is still required.";
}


function promptForRequiredInput() {
  const prereq = getPrerequisiteCheck(currentStory);
  if (prereq.needed && !isPrerequisitesSatisfied()) {
    promptForPrerequisites();
    return;
  }
  const humanNeed = getLiveHumanInputNeed(currentStory);
  if (humanNeed.needsHumanInput && !isHumanInputSatisfied(humanNeed)) {
    updateHumanInputPanel(currentStory, { forceShow: true, humanInputNeed: humanNeed });
    setHumanInputStatus("err", humanNeed.action || `Provide ${humanInputTypeLabel(humanNeed.types)} before execution`);
    el("human-input-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}


function rebuildDataExtractorValidationGate() {
  if (!currentStory) return;
  const slice = findDataExtractorGateSlice();
  if (!slice) return;

  const validation = validateTestDataExtractorOutput(
    currentStory,
    storyOutputs.test_data_extractor,
    storyOutputs.writer,
    storyOutputs.analyst,
  );
  const s = currentStory.id;
  const tc = currentStory.test_cases.length;
  const requiresApi = storyRequiresApi(currentStory);
  const requiresWeb = storyRequiresWebpage(currentStory);
  const inputNeed = getLiveHumanInputNeed(currentStory);
  const humanSource = inputNeed.types.map((t) => (t === "api" ? "human-provided API" : "human-provided webpage")).join(" + ");
  const dataExtractorReturns = {
    success: validation.passed,
    datasets: tc + " row(s)",
    fixtures: tc + " fixture file(s)",
    env_vars: inputNeed.needsHumanInput ? `from human ${inputNeed.types.join(" + ")}` : 3,
    source: inputNeed.needsHumanInput ? humanSource : "story context",
  };

  const opts = {
    gateDecision: "proceed to test_execution",
    gateMessage: validation.passed
      ? `Orchestrator approved Test Data Extractor output — datasets verified against human ${inputNeed.types.join(" + ")}`
      : undefined,
  };

  if (!validation.passed) {
    opts.failAttempts = [1];
    opts.failures = validation.detail_failures || validation.failures;
    opts.failRecommendation = validation.recommendation;
    opts.retryInstructions = {
      target_agent: "Test Data Extractor (L3)",
      task: "RETRY — datasets must match human-provided requirement input, not unrelated mock data",
      validator_feedback: (validation.detail_failures || validation.failures).join("; "),
      corrections: [
        requiresApi ? "Derive valid/invalid/boundary fields from curl URL, query params, headers, and body" : null,
        requiresApi ? "Set api_endpoint to curl method + full URL" : null,
        requiresWeb ? "Derive page_url/page_title from human-provided webpage URL" : null,
        requiresWeb ? "Set webpage_url to the provided page URL" : null,
        "Re-sync requirement_id, requirement_text, and testable_condition per writer test case",
        "Valid lat ∈ [-90,90], lon ∈ [-180,180]; invalid lat=91/lon=181; boundary lat=±90, lon=±180",
        "If requirements changed, rebuild datasets against current analyst AC and writer cases",
      ].filter(Boolean),
    };
    opts.retryEvents = [
      {
        kind: "agent_assign",
        phase: "test_data_extraction",
        message: "Orchestrator re-assigns Test Data Extractor — fix requirement-driven datasets",
        role: "test_data_extractor",
        is_retry: true,
        feedback_addressed: opts.retryInstructions.corrections,
        orchestrator_memory: mem(currentStory, { phase: "test_data_extraction", retry: true }),
        agent_context: { ticket: s, deliver: `datasets from human ${inputNeed.types.join(" + ")} only` },
        agent_returns: {},
        decision: null,
      },
      {
        kind: "agent_return",
        phase: "test_data_extraction",
        message: "Corrected — test data re-extracted from human-provided " + inputNeed.types.join(" + ") + " for " + tc + " test case(s).",
        role: "test_data_extractor",
        is_retry: true,
        changes_made: opts.retryInstructions.corrections,
        orchestrator_memory: mem(currentStory, { phase: "test_data_extraction", datasets: String(tc), retry: "corrected" }),
        agent_context: {},
        agent_returns: dataExtractorReturns,
        decision: null,
        structured_output: "__test_data_extractor__",
      },
    ];
  }

  const newGate = validationGateEvents("test_data_extractor", "test_data_extraction", currentStory, dataExtractorReturns, opts);
  EVENTS = EVENTS.slice(0, slice.start).concat(newGate).concat(EVENTS.slice(slice.end));
  const totalEl = el("step-total");
  if (totalEl) totalEl.textContent = EVENTS.length;
}


function rebuildHumanInputEventSlice() {
  if (!currentStory) return;
  const slice = findHumanInputEventSlice();
  const newEvents = buildHumanInputEvents(
    currentStory,
    storyOutputs.writer?.test_cases,
    storyOutputs.analyst,
  );
  if (!slice) {
    if (!newEvents.length) return;
    const writerEnd = EVENTS.findIndex((e) => e.kind === "validator_assign" && e.target_agent === "writer");
    const insertAt = writerEnd >= 0 ? EVENTS.findIndex((e, i) => i > writerEnd && e.kind === "orchestrator_gate" && e.target_agent === "writer") + 1 : -1;
    if (insertAt > 0) {
      EVENTS = EVENTS.slice(0, insertAt).concat(newEvents).concat(EVENTS.slice(insertAt));
      const totalEl = el("step-total");
      if (totalEl) totalEl.textContent = EVENTS.length;
    }
    return;
  }
  if (!newEvents.length) {
    EVENTS = EVENTS.slice(0, slice.start).concat(EVENTS.slice(slice.end));
  } else {
    EVENTS = EVENTS.slice(0, slice.start).concat(newEvents).concat(EVENTS.slice(slice.end));
  }
  const totalEl = el("step-total");
  if (totalEl) totalEl.textContent = EVENTS.length;
  updateHumanInputPanel(currentStory);
}


function renderActiveOutputTab() {
  const body = el("output-body");
  if (!body) return;
  body.classList.toggle("report-view-active", activeOutputTab === "reporter");

  if (activeOutputTab === "reporter") {
    const meta = AGENT_META.reporter;
    const status = agentStatuses.reporter || "pending";
    const report = status === "done" ? getReportData() : null;
    body.innerHTML = `
      <div class="output-header">
        <h3>${meta.icon} ${meta.label} <span style="color:var(--muted);font-weight:400;font-size:.75rem">${meta.level}</span></h3>
        <span class="output-status ${status}">${status === "done" ? "ready" : status}</span>
      </div>
      ${report ? `
        <div class="report-toolbar">
          <button type="button" class="btn btn-report-download-inline" title="Download .docx + .json">
            <i class="ti ti-download"></i> Download report
          </button>
        </div>
        ${renderReportView(report)}` : `<div class="output-empty">Reporter is generating the Test Summary Report…</div>`}`;
    return;
  }

  const meta = AGENT_META[activeOutputTab];
  const status = agentStatuses[activeOutputTab] || "pending";
  const data = agentOutputs[activeOutputTab];

  if (activeOutputTab === "orchestrator") {
    if (status === "pending" && !data) {
      body.innerHTML = `<div class="output-empty">${meta.icon} <strong>${meta.label}</strong> (${meta.level}) — press Play to start the QA pipeline.</div>`;
      return;
    }
    const orchStatus = status === "done" ? "done" : "working";
    body.innerHTML = `
      <div class="output-header">
        <h3>${meta.icon} ${meta.label} <span style="color:var(--muted);font-weight:400;font-size:.75rem">${meta.level}</span></h3>
        <span class="output-status ${orchStatus}">${orchStatus}</span>
      </div>
      ${renderOrchestratorOutput(data)}
      ${data ? `<details style="margin-top:.75rem"><summary style="cursor:pointer;font-size:.72rem;color:var(--muted)">Raw JSON</summary><pre class="output-json" style="margin-top:.5rem">${escapeHtml(JSON.stringify(data, null, 2))}</pre></details>` : ""}`;
    return;
  }

  if (activeOutputTab === "validator") {
    if (status === "pending" && !data) {
      body.innerHTML = `<div class="output-empty">${meta.icon} <strong>${meta.label}</strong> (${meta.level}) — checks each agent output (max ${VALIDATOR_MAX_ATTEMPTS} attempts). 2nd failure aborts the run.</div>`;
      return;
    }
    const valStatus = status === "done" ? "done" : data ? "working" : "pending";
    body.innerHTML = `
      <div class="output-header">
        <h3>${meta.icon} ${meta.label} <span style="color:var(--muted);font-weight:400;font-size:.75rem">${meta.level}</span></h3>
        <span class="output-status ${valStatus}">${valStatus}</span>
      </div>
      ${renderValidatorOutput(data)}
      ${data ? `<details style="margin-top:.75rem"><summary style="cursor:pointer;font-size:.72rem;color:var(--muted)">Raw JSON</summary><pre class="output-json" style="margin-top:.5rem">${escapeHtml(JSON.stringify(data, null, 2))}</pre></details>` : ""}`;
    return;
  }

  if (status === "pending" && !data) {
    body.innerHTML = `<div class="output-empty">${meta.icon} <strong>${meta.label}</strong> (${meta.level}) — waiting for orchestrator assignment…</div>`;
    return;
  }

  if (status === "working" && !data) {
    body.innerHTML = `<div class="output-header"><h3>${meta.icon} ${meta.label} <span style="color:var(--muted);font-weight:400;font-size:.75rem">${meta.level}</span></h3><span class="output-status working">working</span></div><div class="output-empty">Agent is processing the handoff…</div>`;
    return;
  }

  let content = "";
  if (activeOutputTab === "writer" && data) {
    content = renderWriterOutput(data);
  } else if (activeOutputTab === "test_data_extractor" && data) {
    content = renderTestDataOutput(data);
  } else if (activeOutputTab === "author" && data) {
    content = renderAuthorOutput(data);
  } else if (activeOutputTab === "test_executor" && data) {
    content = renderTestExecutorOutput(data);
  } else if (activeOutputTab === "reviewer" && data) {
    content = renderReviewerOutput(data);
  } else if (activeOutputTab === "analyst" && data) {
    content = renderStructuredAnalystOutput(data);
  } else if (data) {
    content = `<div class="output-kv">${Object.entries(data).map(([k, v]) => renderKv(k, v)).join("")}</div>`;
  } else {
    content = `<div class="output-empty">No output yet.</div>`;
  }

  body.innerHTML = `
    <div class="output-header">
      <h3>${meta.icon} ${meta.label} <span style="color:var(--muted);font-weight:400;font-size:.75rem">${meta.level}</span></h3>
      <span style="display:flex;gap:.4rem;align-items:center">
        ${renderRunnerBadge(data)}
        <span class="output-status ${status}">${status}</span>
      </span>
    </div>
    ${renderAgentChangesBlock(activeOutputTab)}
    ${content}
    ${status === "done" && activeOutputTab !== "reporter" ? `<details style="margin-top:.75rem"><summary style="cursor:pointer;font-size:.72rem;color:var(--muted)">Raw JSON</summary><pre class="output-json" style="margin-top:.5rem">${escapeHtml(JSON.stringify(data, null, 2))}</pre></details>` : ""}`;

  bindOutlineApprovalButtons(body);
}


function renderAgentChangesBlock(role) {
  const log = agentChangeLog[role];
  if (!log) return "";
  const changes = log.changes.map((c) => `<li><span class="validation-pass">✓</span> ${escapeHtml(c)}</li>`).join("");
  const fieldDiffs = log.before && log.after
    ? Object.keys(log.after).filter((k) => JSON.stringify(log.before[k]) !== JSON.stringify(log.after[k])).map((k) =>
        `<div class="feedback-change"><span class="before">${escapeHtml(k)}: ${escapeHtml(String(log.before[k] ?? "—"))}</span><span>→</span><span class="after">${escapeHtml(String(log.after[k]))}</span></div>`
      ).join("")
    : "";
  return `<div class="output-kv-item validator" style="margin-bottom:.75rem">
    <div class="output-kv-key">Applied after validator feedback</div>
    <div class="output-kv-val">
      <div style="font-size:.78rem;margin-bottom:.35rem">${escapeHtml(log.message || "")}</div>
      <ul style="margin:0;padding-left:1rem;font-size:.78rem">${changes}</ul>
      ${fieldDiffs ? `<div style="margin-top:.5rem">${fieldDiffs}</div>` : ""}
    </div>
  </div>`;
}


function renderAnalystScratchpad(scratchpad) {
  const text = typeof scratchpad === "string"
    ? scratchpad
    : (scratchpad?.rendered || "");
  if (!text) return "";
  return `<details class="analyst-reasoning-accordion" style="margin-bottom:.65rem;border:1px solid var(--border);border-radius:8px;padding:.55rem .7rem;background:var(--surface, #fafafa)">
    <summary style="cursor:pointer;font-size:.78rem;font-weight:600;color:var(--text)">Analyst reasoning</summary>
    <pre class="output-json" style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:.74rem;line-height:1.5;margin:.55rem 0 0">${escapeHtml(text)}</pre>
  </details>`;
}

function renderOrchestratorActionRows(actions) {
  if (!actions?.length) return "";
  const rows = actions.map((a) => {
    const verb = escapeHtml(a.action || "ACTION");
    const target = escapeHtml(a.target || "—");
    const detail = escapeHtml(a.detail || "");
    const blocking = a.blocking === true
      ? `<span style="font-size:.65rem;color:#b91c1c;margin-left:.35rem">blocking</span>`
      : "";
    return `<div class="orch-action-row" style="display:flex;gap:.5rem;align-items:flex-start;margin-bottom:.4rem;font-size:.78rem;line-height:1.45">
      <span style="flex-shrink:0;background:#1e293b;color:#fff;border-radius:4px;padding:.1rem .4rem;font-size:.68rem;font-weight:600;font-family:ui-monospace,monospace">${verb}</span>
      <span><strong>${target}</strong> — ${detail}${blocking}</span>
    </div>`;
  }).join("");
  return `<div class="output-kv-item validator"><div class="output-kv-key">Orchestrator actions</div><div class="output-kv-val">${rows}</div></div>`;
}

function renderBlockingPrerequisitesSection(blocking) {
  if (!blocking?.length) return "";
  const rows = blocking.map((p) => {
    const satisfied = p.satisfied_by_ticket === true;
    const badge = satisfied
      ? `<span style="display:inline-block;background:#dcfce7;color:#166534;border-radius:4px;padding:.05rem .4rem;font-size:.65rem;font-weight:700">SATISFIED</span>`
      : `<span style="display:inline-block;background:#fee2e2;color:#991b1b;border-radius:4px;padding:.05rem .4rem;font-size:.65rem;font-weight:700">MISSING</span>`;
    return `<div style="margin-bottom:.5rem;padding-bottom:.45rem;border-bottom:1px solid var(--border);font-size:.78rem;line-height:1.45">
      ${badge}
      <strong style="margin-left:.35rem">${escapeHtml(p.item || "—")}</strong>
      <div class="muted" style="font-size:.72rem;margin-top:.15rem">[${escapeHtml(p.category || "—")}]${p.derived_from ? ` · from: ${escapeHtml(p.derived_from)}` : ""}</div>
      ${!satisfied && p.if_not_satisfied ? `<div class="muted" style="font-size:.72rem">${escapeHtml(p.if_not_satisfied)}</div>` : ""}
    </div>`;
  }).join("");
  return `<div class="output-kv-item validator"><div class="output-kv-key">Blocking prerequisites</div><div class="output-kv-val">${rows}</div></div>`;
}


function renderCurlPreview(parsed) {
  const preview = el("human-api-preview");
  if (!preview) return;
  if (parsed?.ok) {
    preview.hidden = false;
    preview.textContent = formatCurlPreview(parsed);
  } else {
    preview.hidden = true;
    preview.textContent = "";
  }
}


function renderDict(obj) {
  if (!obj || !Object.keys(obj).length) return "—";
  return Object.entries(obj).map(([k, v]) => k + ": " + v).join("\n");
}


function renderEventFeedbackClarification(e, eventIndex) {
  const loops = buildFeedbackLoops(eventIndex);
  const panel = el("feedback-panel");
  const content = el("feedback-loop-content");
  if (!panel || !content) return;

  const hasFeedbackEvent = [
    "validator_return", "validator_brake", "orchestrator_reinstruct", "orchestrator_abort",
    "agent_assign", "agent_return", "orchestrator_gate", "run_failed",
    "human_input_request", "orchestrator_inactivity_timeout", "prerequisite_input_request", "prerequisite_input_received",
  ].includes(e.kind) && (e.kind !== "validator_return" || !e.passed || e.attempt === 2);

  const relatedLoop = loops.find((l) =>
    l.feedback.step === eventIndex + 1
    || l.orchestrator_action?.step === eventIndex + 1
    || l.agent_retry?.assign_step === eventIndex + 1
    || l.agent_retry?.return_step === eventIndex + 1
    || l.outcome?.step === eventIndex + 1
  );

  if (!hasFeedbackEvent && !relatedLoop && loops.length === 0) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  let stepNote = "";

  if (e.kind === "validator_return" && !e.passed) {
    const retriesLeft = VALIDATOR_MAX_ATTEMPTS - (e.attempt || 1);
    const failureList = e.validation?.detail_failures?.length
      ? e.validation.detail_failures
      : (e.validation?.failures || []);
    stepNote = `<div class="feedback-step fail" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · check ${e.attempt}/${VALIDATOR_MAX_ATTEMPTS} failed</div>
      <div>Validator rejected <strong>${escapeHtml(AGENT_META[e.target_agent]?.label || e.target_agent)}</strong> output (check only — does not rewrite agent work):</div>
      <ul style="margin:.35rem 0 0;padding-left:1rem">${failureList.map((f) => `<li class="validation-fail">${escapeHtml(f)}</li>`).join("")}</ul>
      ${e.target_agent === "test_data_extractor" && e.validation?.api_checks ? `<div style="margin-top:.35rem;font-size:.78rem"><strong>API checks:</strong><ul style="margin:.25rem 0 0;padding-left:1rem">${e.validation.api_checks.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul></div>` : ""}
      ${e.validation?.recommendation ? `<div style="margin-top:.35rem"><strong>Recommendation:</strong> ${escapeHtml(e.validation.recommendation)}</div>` : ""}
      <div style="margin-top:.35rem;font-size:.78rem">${retriesLeft > 0
        ? `<strong>${retriesLeft} retry left</strong> — orchestrator may re-instruct the agent once.`
        : `<strong class="validation-fail">No retries left</strong> — validator brake will abort the run.`}</div>
    </div>`;
  } else if (e.kind === "validator_brake") {
    stepNote = `<div class="feedback-step fail" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · validator brake (2/${VALIDATOR_MAX_ATTEMPTS} failures)</div>
      <div>Per validator guidelines, <strong>${VALIDATOR_MAX_ATTEMPTS} failed checks</strong> on the same agent handoff aborts the entire QA run. No further retries.</div>
    </div>`;
  } else if (e.kind === "orchestrator_abort") {
    const orchInactive = e.agent_returns?.reason === "orchestrator_inactivity_timeout"
      || e.orchestrator_memory?.reason === "orchestrator_inactivity_timeout";
    stepNote = `<div class="feedback-step fail" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · orchestrator halts pipeline</div>
      <div>${orchInactive
        ? `Orchestrator <strong>stopped the run</strong> — no action for ${ORCHESTRATOR_INACTIVITY_TIMEOUT_MS / 1000} seconds while blocked at ${escapeHtml(AGENT_META[e.target_agent]?.label || e.target_agent)}.`
        : `Orchestrator received validator brake signal and <strong>stopped the run</strong> for ${escapeHtml(AGENT_META[e.target_agent]?.label || e.target_agent)}.`}</div>
    </div>`;
  } else if (e.kind === "prerequisite_input_request") {
    const check = e.prerequisite_need || getPrerequisiteCheck(currentStory);
    stepNote = `<div class="feedback-step action" style="margin-bottom:.75rem">
      <div class="feedback-step-label">Analyst reasoning from your user story</div>
      ${(check.story_analysis?.test_actions || []).map((t) =>
        `<div style="font-size:.78rem;margin-bottom:.25rem"><strong>${escapeHtml(t.ac)}</strong> "${escapeHtml(t.ac_text)}" → ${escapeHtml(t.action)}</div>`
      ).join("")}
      ${check.items.length
        ? `<div style="margin-top:.5rem">Only <strong>${check.items.length}</strong> gap(s) need your input:${check.items.map((i) => `<br>• <strong>${escapeHtml(i.label)}</strong> (${escapeHtml((i.required_for || []).join(", "))}) — ${escapeHtml(i.analyst_note || i.reason)}`).join("")}</div>`
        : `<div style="margin-top:.35rem">Ticket is complete — no extra input needed.</div>`}
    </div>`;
  } else if (e.kind === "human_input_request") {
    const need = e.human_input_need || getLiveHumanInputNeed(currentStory);
    const ask = need.action || humanInputTypeLabel(need.types);
    stepNote = `<div class="feedback-step action" style="margin-bottom:.75rem">
      <div class="feedback-step-label">Story requires your input</div>
      <div>${escapeHtml(ask)}${need.reason ? `<div style="margin-top:.35rem;font-size:.78rem;color:var(--text-muted)">${escapeHtml(need.reason)}</div>` : ""}</div>
    </div>`;
  } else if (e.kind === "orchestrator_inactivity_timeout") {
    stepNote = `<div class="feedback-step fail" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · orchestrator inactivity timeout</div>
      <div class="validation-fail"><strong>No orchestrator action for ${ORCHESTRATOR_INACTIVITY_TIMEOUT_MS / 1000} seconds.</strong> Pipeline aborted — loop failed.</div>
    </div>`;
  } else if (e.kind === "run_failed") {
    const orchInactive = e.agent_returns?.reason === "orchestrator_inactivity_timeout"
      || e.orchestrator_memory?.reason === "orchestrator_inactivity_timeout";
    stepNote = `<div class="feedback-step fail" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · run failed</div>
      <div class="validation-fail"><strong>QA run failed.</strong> ${orchInactive
        ? `Goal not achieved — orchestrator took no action for ${ORCHESTRATOR_INACTIVITY_TIMEOUT_MS / 1000} seconds.`
        : `Goal not achieved — agent output did not pass validation within ${VALIDATOR_MAX_ATTEMPTS} attempts.`}</div>
    </div>`;
  } else if (e.kind === "orchestrator_reinstruct") {
    const fb = e.validation_feedback;
    stepNote = `<div class="feedback-step action" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · orchestrator responds to feedback (1 retry allowed)</div>
      <div><strong>Because validator said:</strong> ${escapeHtml((fb?.failures || []).join("; "))}</div>
      <div style="margin-top:.35rem"><strong>Orchestrator did:</strong> sent one corrective re-instruction to ${escapeHtml(AGENT_META[e.target_agent]?.label || e.target_agent)}. If attempt 2 fails, the run aborts.</div>
      ${(e.instructions?.corrections || []).length ? `<ul style="margin:.35rem 0 0;padding-left:1rem">${e.instructions.corrections.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : ""}
    </div>`;
  } else if (e.kind === "agent_assign" && e.is_retry) {
    stepNote = `<div class="feedback-step response" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · final agent retry (attempt 2/${VALIDATOR_MAX_ATTEMPTS})</div>
      <div><strong>${escapeHtml(AGENT_META[e.role]?.label || e.role)}</strong> re-runs once after validator feedback. This is the last chance before run abort.</div>
      ${(e.feedback_addressed || []).length ? `<div style="margin-top:.35rem"><strong>Must fix:</strong><ul style="margin:.25rem 0 0;padding-left:1rem">${e.feedback_addressed.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul></div>` : ""}
    </div>`;
  } else if (e.kind === "agent_return" && e.is_retry) {
    const fixed = e.structured_output;
    stepNote = `<div class="feedback-step response" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · agent retry result</div>
      <div><strong>${escapeHtml(AGENT_META[e.role]?.label || e.role)}</strong> ${fixed ? "returned corrected output" : "returned output still failing guidelines"}:</div>
      ${(e.changes_made || []).length ? `<ul style="margin:.35rem 0 0;padding-left:1rem">${e.changes_made.map((c) => `<li><span class="${fixed ? "validation-pass" : "validation-fail"}">${fixed ? "✓" : "✗"}</span> ${escapeHtml(c)}</li>`).join("")}</ul>` : ""}
      ${!fixed ? `<div style="margin-top:.35rem" class="validation-fail">Validator will check again — 2nd failure aborts the run.</div>` : ""}
    </div>`;
  } else if (e.kind === "validator_return" && e.passed && e.target_agent === "test_data_extractor") {
    const reqSummary = e.validation?.requirements_summary;
    stepNote = `<div class="feedback-step outcome" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · requirements + data verified</div>
      <div>Validator confirmed datasets match <strong>current requirements</strong> (analyst + AC + writer), provided API data, coordinates, and per-test-case linkage.</div>
      ${reqSummary ? `<div style="margin-top:.35rem;font-size:.78rem"><strong>Requirements checked:</strong> ${escapeHtml(reqSummary)}</div>` : ""}
      ${humanApiInput.ok ? `<div style="margin-top:.35rem;font-size:.78rem">API: <code>${escapeHtml(humanApiInput.method)} ${escapeHtml(humanApiInput.url)}</code></div>` : ""}
      ${humanWebpageInput.ok ? `<div style="margin-top:.35rem;font-size:.78rem">Web: <code>${escapeHtml(humanWebpageInput.url)}</code></div>` : ""}
    </div>`;
  } else if (e.kind === "validator_return" && e.passed && e.attempt === 2) {
    stepNote = `<div class="feedback-step outcome" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · feedback addressed</div>
      <div>Re-validation passed after the agent applied orchestrator corrections. Pipeline can advance.</div>
    </div>`;
  } else if (e.kind === "orchestrator_gate") {
    stepNote = `<div class="feedback-step outcome" style="margin-bottom:.75rem">
      <div class="feedback-step-label">This step · gate open</div>
      <div>All validator checks passed for <strong>${escapeHtml(AGENT_META[e.target_agent]?.label || e.target_agent)}</strong>. Orchestrator advances: <em>${escapeHtml(e.decision || "")}</em></div>
    </div>`;
  }

  content.innerHTML = stepNote + (loops.length ? `<div style="margin-top:.5rem;font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:.5rem">Full feedback history</div>${renderFeedbackLoopsHtml(loops, eventIndex + 1)}` : "");
}


function renderFeedbackLoopsHtml(loops, highlightStep) {
  if (!loops.length) return "";
  return loops.map((loop) => {
    const isActive = !loop.resolved && highlightStep >= loop.started_at_step;
    const isAborted = loop.aborted;
    const cls = ["feedback-loop", loop.resolved && !isAborted ? "resolved" : "", isAborted ? "aborted" : "", isActive && !isAborted ? "active" : ""].filter(Boolean).join(" ");
    const failedChecks = (loop.feedback.failed_checks || []).map((c) =>
      `<li><span class="validation-fail">✗</span> ${escapeHtml(c.rule)}</li>`
    ).join("");
    const corrections = (loop.orchestrator_action?.corrections || []).map((c) =>
      `<li>${escapeHtml(c)}</li>`
    ).join("");
    const changes = (loop.agent_retry?.changes_made || []).map((c) =>
      `<li><span class="validation-pass">✓</span> ${escapeHtml(c)}</li>`
    ).join("");
    const beforeAfter = loop.agent_retry?.before && loop.agent_retry?.after
      ? Object.keys(loop.agent_retry.after).filter((k) => {
          const b = loop.agent_retry.before[k];
          const a = loop.agent_retry.after[k];
          return JSON.stringify(b) !== JSON.stringify(a);
        }).map((k) =>
          `<div class="feedback-change"><span class="before">${escapeHtml(k)}: ${escapeHtml(String(loop.agent_retry.before[k] ?? "—"))}</span><span>→</span><span class="after">${escapeHtml(String(loop.agent_retry.after[k]))}</span></div>`
        ).join("")
      : "";

    return `<div class="${cls}">
      <h4>${isAborted ? "🛑" : loop.resolved ? "✅" : "⚠️"} ${escapeHtml(loop.agent_label)} — ${isAborted ? "run aborted (2nd failure)" : loop.resolved ? "feedback resolved" : "awaiting resolution"}</h4>

      <div class="feedback-step feedback">
        <div class="feedback-step-label">1 · Validator feedback (step ${loop.feedback.step})</div>
        <div><strong>Failed:</strong> ${escapeHtml(loop.feedback.failures.join("; ") || "guideline checks")}</div>
        ${loop.feedback.recommendation ? `<div style="margin-top:.25rem"><strong>Recommendation:</strong> ${escapeHtml(loop.feedback.recommendation)}</div>` : ""}
        ${failedChecks ? `<ul style="margin:.35rem 0 0;padding-left:1rem">${failedChecks}</ul>` : ""}
      </div>

      ${loop.orchestrator_action ? `
      <div class="feedback-arrow">↓ orchestrator acted on feedback</div>
      <div class="feedback-step action">
        <div class="feedback-step-label">2 · Orchestrator action (step ${loop.orchestrator_action.step})</div>
        <div><strong>Decision:</strong> ${escapeHtml(loop.orchestrator_action.decision || "")}</div>
        <div style="margin-top:.25rem">${escapeHtml(loop.orchestrator_action.message)}</div>
        ${corrections ? `<div style="margin-top:.35rem"><strong>Corrections sent to agent:</strong><ul style="margin:.25rem 0 0;padding-left:1rem">${corrections}</ul></div>` : ""}
      </div>` : `<div class="feedback-arrow">↓ waiting for orchestrator…</div>`}

      ${loop.agent_retry?.return_step ? `
      <div class="feedback-arrow">↓ agent changed output per feedback</div>
      <div class="feedback-step response">
        <div class="feedback-step-label">3 · Agent response (step ${loop.agent_retry.return_step})</div>
        <div>${escapeHtml(loop.agent_retry.message || "")}</div>
        ${changes ? `<div style="margin-top:.35rem"><strong>What changed:</strong><ul style="margin:.25rem 0 0;padding-left:1rem">${changes}</ul></div>` : ""}
        ${beforeAfter ? `<div style="margin-top:.35rem"><strong>Field changes:</strong>${beforeAfter}</div>` : ""}
      </div>` : loop.orchestrator_action ? `<div class="feedback-arrow">↓ waiting for agent retry…</div>` : ""}

      ${loop.outcome ? `
      <div class="feedback-arrow">↓ ${loop.outcome.aborted ? "validator brake — run stopped" : "validator re-checked"}</div>
      <div class="feedback-step ${loop.outcome.aborted ? "fail" : "outcome"}">
        <div class="feedback-step-label">4 · Outcome (step ${loop.outcome.step})</div>
        <div class="${loop.outcome.aborted ? "validation-fail" : "validation-pass"}">${escapeHtml(loop.outcome.message)}${loop.outcome.aborted ? " — no further retries" : " — pipeline may advance"}</div>
      </div>` : loop.agent_retry?.return_step ? `<div class="feedback-arrow">↓ waiting for re-validation (attempt 2 of ${VALIDATOR_MAX_ATTEMPTS})…</div>` : ""}
    </div>`;
  }).join("");
}


function renderKv(key, val) {
  let inner;
  if (Array.isArray(val)) {
    inner = `<ul>${val.map((v) => `<li>${escapeHtml(typeof v === "object" ? JSON.stringify(v) : v)}</li>`).join("")}</ul>`;
  } else if (typeof val === "object" && val !== null) {
    inner = `<pre class="output-json">${escapeHtml(JSON.stringify(val, null, 2))}</pre>`;
  } else {
    inner = escapeHtml(String(val));
  }
  return `<div class="output-kv-item"><div class="output-kv-key">${escapeHtml(key.replace(/_/g, " "))}</div><div class="output-kv-val">${inner}</div></div>`;
}


function renderOrchestratorOutput(data) {
  if (!data) return `<div class="output-empty">Orchestrator waiting to start…</div>`;
  const memEntries = data.current_memory ? Object.entries(data.current_memory) : [];
  const phases = (data.phase_log || []).map((p) =>
    `<div class="tc-row"><div class="tc-row-head"><span class="tc-row-id">#${p.step}</span><span class="tc-type tc-type-happy">${escapeHtml(p.kind.replace(/_/g, " "))}</span><strong style="font-size:.78rem">${escapeHtml(p.phase || "")}</strong></div><div style="font-size:.75rem;color:var(--muted)">${escapeHtml(p.message)}</div></div>`
  ).join("");
  const assigns = (data.assignments || []).map((a) =>
    `<li><strong>${escapeHtml(a.agent)}</strong> · ${escapeHtml(a.phase)} — ${escapeHtml(a.message)}</li>`
  ).join("");
  const decs = (data.decisions || []).map((d) =>
    `<li><strong>${escapeHtml(d.decision)}</strong> <span class="muted">(${escapeHtml(d.phase)})</span> — ${escapeHtml(d.message)}</li>`
  ).join("");
  const instructBlock = data.instructions_to_analyst
    ? `<h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Instructions → Requirement Analyst</h4>
       <div class="output-kv">${Object.entries(data.instructions_to_analyst).map(([k, v]) => renderKv(k, v)).join("")}</div>`
    : "";
  const feedbackBlock = data.feedback_from_analyst
    ? `<h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">← Latest gate / feedback</h4>
       <div class="output-kv">${Object.entries(data.feedback_from_analyst).filter(([k]) => typeof data.feedback_from_analyst[k] !== "object" || Array.isArray(data.feedback_from_analyst[k])).map(([k, v]) => renderKv(k, v)).join("")}</div>`
    : "";
  const gates = (data.validation_gates || []).map((g) =>
    `<li><strong>${escapeHtml(g.agent)}</strong> — <span class="${g.passed ? "validation-pass" : "validation-fail"}">${g.passed ? "PASS" : "FAIL"}</span> ${g.score ? `(${escapeHtml(g.score)})` : ""}${g.failures?.length ? ` · ${escapeHtml(g.failures.join("; "))}` : ""}</li>`
  ).join("");
  const retries = (data.reinstructions || []).map((r) =>
    `<li><strong>${escapeHtml(r.agent)}</strong> — ${escapeHtml(r.reason || r.message)}</li>`
  ).join("");
  const feedbackLoops = renderFeedbackLoopsHtml(data.feedback_loops || [], data.events_processed || 0);
  return `
    <div class="output-kv">
      ${renderKv("model", data.model || MODEL_ORCHESTRATOR)}
      ${data.model_routing ? renderKv("worker_model", data.model_routing.workers) : ""}
      ${renderKv("ticket", data.ticket)}
      ${renderKv("source", data.source)}
      ${renderKv("current_phase", data.current_phase)}
      ${renderKv("progress", `${data.events_processed} / ${data.events_total} events`)}
      ${data.latest_decision ? renderKv("latest_decision", data.latest_decision) : ""}
      ${data.goal ? renderKv("final_goal", data.goal) : ""}
      ${data.run_aborted ? renderKv("run_status", "FAILED — validator brake (2 strikes)") : ""}
      ${renderKv("validator_max_attempts", data.validator_max_attempts)}
      ${data.validator_guidelines ? renderKv("validator_guidelines", data.validator_guidelines) : ""}
      ${renderKv("pipeline_plan", data.pipeline_plan)}
      ${Array.isArray(data.agents_in_pipeline) ? renderKv("agents_in_pipeline", data.agents_in_pipeline.map((a) => typeof a === "string" ? a : `${a.role} → ${a.model}`)) : ""}
    </div>
    <h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Current memory</h4>
    <div class="output-kv">${memEntries.map(([k, v]) => renderKv(k, v)).join("")}</div>
    ${instructBlock}
    ${feedbackBlock}
    ${gates ? `<h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Validation gates</h4><ul style="margin:0;padding-left:1.1rem;font-size:.78rem;color:var(--text-secondary);line-height:1.55">${gates}</ul>` : ""}
    ${retries ? `<h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Re-instructions (validator feedback)</h4><ul style="margin:0;padding-left:1.1rem;font-size:.78rem;color:var(--text-secondary);line-height:1.55">${retries}</ul>` : ""}
    ${feedbackLoops ? `<h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Feedback → action → outcome</h4>${feedbackLoops}` : ""}
    ${assigns ? `<h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Agent assignments</h4><ul style="margin:0;padding-left:1.1rem;font-size:.78rem;color:var(--text-secondary);line-height:1.55">${assigns}</ul>` : ""}
    ${decs ? `<h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Decisions</h4><ul style="margin:0;padding-left:1.1rem;font-size:.78rem;color:var(--text-secondary);line-height:1.55">${decs}</ul>` : ""}
    <h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Phase log</h4>
    ${phases || '<div class="muted" style="font-size:.78rem">No phases yet</div>'}`;
}


function renderOutputTabs() {
  document.querySelectorAll(".output-tab").forEach((tab) => {
    const role = tab.dataset.agent;
    tab.classList.toggle("active", role === activeOutputTab);
    tab.classList.toggle("done", agentStatuses[role] === "done");
  });
}


function renderPipelineBar(activeRole, doneRoles) {
  const bar = el("pipeline-bar");
  if (!bar) return;
  bar.innerHTML = PIPELINE_STEPS.map((step, i) => {
    const isDone = doneRoles.has(step.id) || (step.id !== "orchestrator" && agentStatuses[step.id] === "done");
    const isRunning = step.id === activeRole || (activeRole === "orchestrator" && step.id === "orchestrator" && idx >= 0);
    const cls = ["pipeline-step", step.id, isDone ? "done" : "", isRunning && !isDone ? "running" : ""].filter(Boolean).join(" ");
    const connector = i < PIPELINE_STEPS.length - 1
      ? `<div class="pipeline-connector ${isDone ? "done" : ""}"></div>` : "";
    const inner = isDone ? '<i class="ti ti-check" style="font-size:14px"></i>' : step.icon;
    const model = getModelForAgent(step.id);
    const modelShort = model.includes("fable") ? "Fable 5" : "Sonnet";
    return `${i > 0 ? "" : ""}<div class="${cls}" title="${escapeHtml(model)}"><div class="pipeline-dot">${inner}</div><span class="pipeline-label">${step.label}</span><span class="pipeline-model" style="font-size:.58rem;color:var(--text-muted);margin-top:.15rem">${modelShort}</span></div>${connector}`;
  }).join("");
}


function renderReportView(report) {
  if (!report) {
    return `<div class="output-empty">Test Summary Report will appear here when the Reporter step completes.</div>`;
  }

  const s = report.summary || {};
  const d = report.defects || {};
  const scopeItems = typeof inScopeItems === "function" ? inScopeItems(report) : [];
  const inScopeHtml = scopeItems.length
    ? `<ul>${scopeItems.map((item) => {
        const link = item.linkUrl
          ? `<a class="report-ticket-link" href="${escapeHtml(item.linkUrl)}" target="_blank" rel="noopener">${escapeHtml(item.linkLabel)}</a>`
          : escapeHtml(item.linkLabel || "");
        return `<li>${escapeHtml(item.title)} ${link}</li>`;
      }).join("")}</ul>`
    : `<span class="muted">—</span>`;

  const outScope = (report.out_of_scope || []).filter(Boolean);
  const notTested = (report.items_not_tested || []).filter(Boolean);

  return `
    <div class="report-doc">
      <h3 class="report-doc-title">TEST SUMMARY REPORT</h3>

      <h4>General Information</h4>
      <table class="report-doc-table">
        <tbody>
          <tr><th class="label-col">Project Name</th><td colspan="3">${escapeHtml(report.project_name || "SEHA")}</td></tr>
          <tr>
            <th class="label-col">Version No.</th>
            <th>Release No.</th>
            <th>Report Date</th>
            <th>Environment</th>
          </tr>
          <tr>
            <td>${escapeHtml(report.version_info || "—")}</td>
            <td>${escapeHtml(report.release_no || report.ticket_title || "—")}</td>
            <td>${escapeHtml(formatReportDate ? formatReportDate(report.report_date) : (report.report_date || "—"))}</td>
            <td>${escapeHtml(report.environment || "QA")}</td>
          </tr>
        </tbody>
      </table>

      <h4>Release Overview</h4>
      <div class="report-platform-row">
        <span>☒ Backend</span>
        <span>☐ Mobile Responsive</span>
        <span>☒ Web</span>
        <span>☐ Android &nbsp; ☐ iOS</span>
      </div>
      <div class="report-scope-grid">
        <div class="scope-head">In Scope</div>
        <div class="scope-head">Out of Scope</div>
        <div class="scope-head">Items not tested</div>
        <div class="scope-head">Regression Testing</div>
        <div class="scope-cell">${inScopeHtml}</div>
        <div class="scope-cell">${outScope.length ? `<ul>${outScope.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "—"}</div>
        <div class="scope-cell">${notTested.length ? `<ul>${notTested.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "—"}</div>
        <div class="scope-cell"><strong>${escapeHtml(report.regression_status || "Planned")}</strong></div>
      </div>

      <h4>Number of Test Cases Planned vs Executed</h4>
      <div class="report-stats-row">
        <div><div class="stat-head">TCs Planned</div><div class="stat-val">${s.planned ?? 0}</div></div>
        <div><div class="stat-head">TCs Executed</div><div class="stat-val">${s.executed ?? 0}</div></div>
        <div><div class="stat-head">TCs Passed</div><div class="stat-val" style="color:var(--pass)">${s.passed ?? 0}</div></div>
        <div><div class="stat-head">TCs Failed</div><div class="stat-val" style="color:var(--warn)">${s.failed ?? 0}</div></div>
      </div>

      <h4>Defects Report</h4>
      <table class="report-doc-table">
        <thead><tr><th>Reported Defects</th><th>Fixed Defects</th><th>Opened Defects</th><th></th></tr></thead>
        <tbody>
          <tr>
            <td>${d.reported ?? 0}</td>
            <td>${d.fixed ?? 0}</td>
            <td>${d.opened ?? 0}</td>
            <td></td>
          </tr>
          <tr><td></td><td></td><td>Low</td><td>${d.low ?? 0}</td></tr>
          <tr><td></td><td></td><td>Medium</td><td>${d.medium ?? 0}</td></tr>
          <tr><td></td><td></td><td>High</td><td>${d.high ?? 0}</td></tr>
        </tbody>
      </table>

      <h4>Comments</h4>
      <p style="margin:0;font-size:.78rem;color:var(--text-secondary)">${escapeHtml(report.comments || "NA")}</p>
      <p style="margin:.75rem 0 0;font-size:.78rem"><strong>Reported by:</strong> ${escapeHtml(report.reported_by || "QA Agent Farm")}</p>
    </div>`;
}


function renderStructuredAnalystOutput(data) {
  if (!data) return "";
  const parts = [];
  const parsed = data.parsed || data;

  if (parsed.summary) {
    parts.push(`<div class="output-kv-item" style="border-color:#c4b5fd;background:#f5f3ff"><div class="output-kv-key">Summary</div><div class="output-kv-val" style="font-weight:600;font-size:.85rem">${escapeHtml(parsed.summary)}</div></div>`);
  }

  if (parsed.pipeline_state === "NEEDS_INPUT") {
    parts.push(`<div class="output-kv-item validator" style="border-color:#fca5a5;margin-bottom:.65rem"><div class="output-kv-key">Pipeline state</div><div class="output-kv-val" style="color:#b91c1c;font-weight:600">NEEDS_INPUT — zero testable ACs; Writer/Author blocked</div></div>`);
  } else if (parsed.pipeline_state === "WAITING_ON_HUMAN") {
    parts.push(`<div class="output-kv-item validator" style="border-color:#fca5a5;margin-bottom:.65rem"><div class="output-kv-key">Pipeline state</div><div class="output-kv-val" style="color:#b91c1c;font-weight:600">WAITING_ON_HUMAN — resolve orchestrator actions before Agent 2</div></div>`);
  }

  const scratchText = typeof data.scratchpad === "string"
    ? data.scratchpad
    : (parsed.scratchpad?.rendered || parsed.scratchpad || data.scratchpad);
  parts.push(renderAnalystScratchpad(scratchText));

  const conditions = parsed.testable_conditions || [];
  if (conditions.length) {
    const rows = conditions.map((c) => `
      <div class="prereq-ac-row" style="margin-bottom:.55rem;padding-bottom:.55rem;border-bottom:1px solid var(--border)">
        <strong>${escapeHtml(c.id)}</strong> <span class="muted" style="font-size:.72rem">[${escapeHtml(c.source || "—")}]</span><br>
        "${escapeHtml(c.ac_text)}"<br>
        <span class="muted">Roles:</span> ${escapeHtml((c.roles || []).join(", ") || "—")}<br>
        <span class="muted">Testable:</span> ${escapeHtml(c.testable_statement || "—")}<br>
        <span style="color:var(--success)">Pass:</span> ${escapeHtml(c.pass_evidence || "—")}<br>
        <span style="color:#dc2626">Fail:</span> ${escapeHtml(c.fail_evidence || "—")}
        ${c.ambiguous ? `<br><span class="muted">Assumption:</span> ${escapeHtml(c.assumption || "—")}` : ""}
      </div>`).join("");
    parts.push(`<div class="output-kv-item validator"><div class="output-kv-key">Testable conditions (${conditions.length})</div><div class="output-kv-val prereq-ac-map">${rows}</div></div>`);
  }

  const reasoning = parsed.analyst_reasoning;
  if (reasoning) {
    const rejected = (reasoning.rejected_as_non_ac || []).map((r) => `<li class="muted" style="font-size:.74rem">${escapeHtml(r)}</li>`).join("");
    const ambiguous = (reasoning.ambiguous_acs || []).map((a) =>
      `<li style="font-size:.74rem"><strong>${escapeHtml(a.ac_id)}</strong> — ${escapeHtml(a.issue)}<br><span class="muted">Assumption:</span> ${escapeHtml(a.assumption)}</li>`
    ).join("");
    parts.push(`<div class="output-kv-item validator"><div class="output-kv-key">Structured reasoning</div><div class="output-kv-val" style="font-size:.78rem">
      ${reasoning.ticket_read ? `<p style="margin:0 0 .45rem">${escapeHtml(reasoning.ticket_read)}</p>` : ""}
      ${(reasoning.unimplemented_rules || []).length ? `<p style="margin:0 0 .35rem"><strong>Out of scope:</strong> ${escapeHtml(reasoning.unimplemented_rules.join("; "))}</p>` : ""}
      ${rejected ? `<p style="margin:.35rem 0 .2rem;font-size:.72rem;color:var(--muted)">Rejected as non-AC (${reasoning.rejected_as_non_ac.length})</p><ul style="margin:0;padding-left:1.1rem">${rejected}</ul>` : ""}
      ${ambiguous ? `<p style="margin:.35rem 0 .2rem;font-size:.72rem;color:var(--muted)">Ambiguous ACs</p><ul style="margin:0;padding-left:1.1rem">${ambiguous}</ul>` : ""}
    </div></div>`);
  }

  const pn = parsed.prerequisites_needed || {};
  parts.push(renderBlockingPrerequisitesSection(pn.blocking || []));

  const nonBlocking = pn.non_blocking || [];
  if (nonBlocking.length) {
    parts.push(`<div class="output-kv-item validator"><div class="output-kv-key">Non-blocking prerequisites</div><div class="output-kv-val"><ul style="margin:0;padding-left:1.1rem;font-size:.74rem">${nonBlocking.map((p) =>
      `<li><strong>${escapeHtml(p.item)}</strong> [${escapeHtml(p.category)}]${p.derived_from ? ` — ${escapeHtml(p.derived_from)}` : ""}</li>`
    ).join("")}</ul></div></div>`);
  }

  parts.push(renderOrchestratorActionRows(parsed.analyst_report?.orchestrator_actions || []));

  const gaps = parsed.coverage_gaps || [];
  if (gaps.length) {
    parts.push(`<div class="output-kv-item validator"><div class="output-kv-key">Coverage gaps (${gaps.length})</div><div class="output-kv-val"><ul style="margin:0;padding-left:1.1rem;font-size:.74rem">${gaps.map((g) =>
      `<li><strong>${escapeHtml(g.category)}</strong> [${escapeHtml(g.severity)}] — ${escapeHtml(g.gap)}<br><span class="muted">Suggested:</span> ${escapeHtml(g.suggested_test || "—")}</li>`
    ).join("")}</ul></div></div>`);
  }

  const files = parsed.related_files || [];
  if (files.length) {
    parts.push(`<div class="output-kv-item"><div class="output-kv-key">Related files</div><div class="output-kv-val"><ul style="margin:0;padding-left:1.1rem;font-size:.74rem">${files.map((f) =>
      `<li><code>${escapeHtml(f.path || f)}</code>${f.reason ? ` — ${escapeHtml(f.reason)}` : ""}</li>`
    ).join("")}</ul></div></div>`);
  }

  return parts.join("");
}


function renderRunnerBadge(data) {
  const live = /cursor_agent|live/i.test(data?.runner || "")
    || (activeOutputTab === "analyst" && currentStory?.live_analyst_output);
  return `<span title="${live ? "Cursor Agent CLI" : "Simulated stub"}" style="background:${live ? "#166534" : "#57534e"};color:#fff;border-radius:4px;padding:.1rem .4rem;font-size:.62rem;font-weight:700">${live ? "LIVE" : "STUB"}</span>`;
}

function kv(key, val, border) {
  return `<div class="output-kv-item validator" style="margin-bottom:.65rem${border ? `;border-color:${border}` : ""}"><div class="output-kv-key">${key}</div><div class="output-kv-val">${val}</div></div>`;
}

function renderWriterOutput(data) {
  if (!data) return "";
  if (data.blocked) return kv("Blocked", `<span class="validation-fail">${escapeHtml(data.blocked_reason || "Writer blocked")}</span>`, "#fca5a5");
  const outlines = data.test_outlines || [];
  return [
    data.summary ? `<p style="font-size:.8rem;margin:0 0 .65rem;color:var(--text-secondary)">${escapeHtml(data.summary)}</p>` : "",
    outlines.length
      ? `<div class="prereq-section-title" style="margin-top:0">Test outlines — approve before Author</div>${renderTestOutlines(outlines)}`
      : `<div class="output-empty">No outlines yet.</div>`,
    data.test_cases?.length
      ? `<details style="margin-top:.75rem"><summary style="cursor:pointer;font-size:.72rem;color:var(--muted)">GWT docs (${data.test_cases.length})</summary>${renderTestCases(data.test_cases)}</details>`
      : "",
  ].join("");
}

function renderTestOutlines(outlines) {
  const color = { approved: "var(--success)", rejected: "#b91c1c", draft: "#a16207" };
  return (outlines || []).map((o) => {
    const st = o.status || "draft";
    const btns = st === "approved"
      ? `<button type="button" class="btn btn-outline-reject" data-outline-id="${escapeHtml(o.id)}" style="font-size:.72rem;padding:.25rem .55rem;margin-top:.4rem">Revoke</button>`
      : `<span style="display:flex;gap:.35rem;margin-top:.4rem">
          <button type="button" class="btn btn-outline-approve" data-outline-id="${escapeHtml(o.id)}" style="font-size:.72rem;padding:.25rem .55rem">Approve</button>
          <button type="button" class="btn btn-outline-reject" data-outline-id="${escapeHtml(o.id)}" style="font-size:.72rem;padding:.25rem .55rem">Reject</button>
        </span>`;
    return `<div class="tc-row">
      <div class="tc-row-head">
        <span class="tc-row-id">${escapeHtml(o.id)}</span>
        <span style="color:${color[st] || color.draft};font-size:.68rem;font-weight:700;text-transform:uppercase">${escapeHtml(st)}</span>
        <strong style="font-size:.8rem">${escapeHtml(o.title || "")}</strong>
      </div>
      <div style="font-size:.74rem;color:var(--muted)">ACs: ${escapeHtml((o.mapped_acs || []).join(", ") || "—")} · ${escapeHtml(String(o.intent || ""))}${btns}</div>
    </div>`;
  }).join("");
}

function bindOutlineApprovalButtons(root) {
  root?.querySelectorAll(".btn-outline-approve, .btn-outline-reject").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-outline-id");
      const cur = storyOutputs?.writer?.test_outlines?.find((o) => o.id === id);
      const next = btn.classList.contains("btn-outline-approve")
        ? "approved"
        : (cur?.status === "approved" ? "draft" : "rejected");
      setOutlineStatus(id, next);
    });
  });
}

function setOutlineStatus(outlineId, status) {
  const outlines = storyOutputs?.writer?.test_outlines;
  const o = outlines?.find((x) => x.id === outlineId);
  if (!o) return;
  o.status = status;
  const n = outlines.filter((x) => x.status === "approved").length;
  storyOutputs.writer.summary = `${n}/${outlines.length} outline(s) approved`;
  publishAgentOutputForHuman("writer", storyOutputs.writer, "done");
  const authorOut = buildAuthorOutput(
    currentStory, storyOutputs.writer, storyOutputs.analyst,
    humanWebpageInput?.ok ? humanWebpageInput : null,
  );
  publishAgentOutputForHuman("author", authorOut, "done");
  if (el("event-message")) el("event-message").textContent = authorOut.summary || `${outlineId} → ${status}`;
  activeOutputTab = "writer";
  renderOutputTabs();
  renderActiveOutputTab();
}

function renderAuthorOutput(data) {
  if (!data) return "";
  const tone = data.blocked || data.status === "NEEDS_INPUT" || data.status === "FAILED"
    ? "#b91c1c" : data.status === "REVIEW" ? "var(--success)" : "var(--text)";
  const warn = (msg) => kv("Note", `<span style="font-weight:600;color:#a16207">${msg}</span>`, "#fcd34d");
  return [
    data.blocked && (data.status === "BUILDING" || /S2|Playwright/i.test(data.blocked_reason || ""))
      ? warn("Author is a STUB — Executor / COMPLETE blocked until Playwright S2.") : "",
    kv("Author session",
      `<span style="color:${tone};font-weight:600">${escapeHtml(data.status || "—")}${data.session_id ? ` · ${escapeHtml(data.session_id)}` : ""}</span>`,
      data.blocked ? "#fca5a5" : null),
    data.blocked_reason ? kv("Blocked", `<span class="validation-fail">${escapeHtml(data.blocked_reason)}</span>`, "#fca5a5") : "",
    data.summary ? kv("Summary", escapeHtml(data.summary)) : "",
    data.status === "PLAN_READY" && data.outlines?.length
      ? warn("Approve outlines (Writer tab or below).") + renderTestOutlines(data.outlines) : "",
  ].join("");
}

function renderReviewerOutput(data) {
  if (!data) return "";
  const parts = [];
  const recheck = data.human_input_recheck;
  if (recheck) {
    const ok = recheck.passed;
    const rows = (recheck.checks || []).map((c) =>
      `<li style="font-size:.74rem;margin:.3rem 0">
        <strong style="color:${c.status === "pass" ? "var(--success)" : "#b91c1c"}">${escapeHtml((c.status || "").toUpperCase())}</strong>
        — ${escapeHtml(c.asked_for || c.analyst_ref || "")}
        <br><span class="muted">Provided:</span> ${escapeHtml(String(c.provided || "").slice(0, 140))}
        ${c.blame ? `<br><span style="color:#b91c1c"><strong>Blame:</strong> ${escapeHtml(c.blame)}</span>` : ""}
      </li>`
    ).join("");
    parts.push(`
      <div class="output-kv-item validator" style="margin-bottom:.65rem;border-color:${ok ? "#86efac" : "#fca5a5"}">
        <div class="output-kv-key">Human input vs Analyst</div>
        <div class="output-kv-val" style="font-weight:600;color:${ok ? "var(--success)" : "#b91c1c"}">${escapeHtml(recheck.verdict || "")} — ${escapeHtml(recheck.summary || "")}</div>
      </div>
      ${rows ? `<div class="output-kv-item"><div class="output-kv-key">Checks</div><div class="output-kv-val"><ul style="margin:0;padding-left:1.1rem">${rows}</ul></div></div>` : ""}
      ${recheck.fix ? `<div class="output-kv-item"><div class="output-kv-key">Fix</div><div class="output-kv-val">${escapeHtml(recheck.fix)}</div></div>` : ""}
    `);
  }
  // Keep legacy score fields when present (post-executor review).
  const rest = Object.entries(data)
    .filter(([k]) => k !== "human_input_recheck")
    .map(([k, v]) => renderKv(k, v))
    .join("");
  if (rest) parts.push(`<div class="output-kv">${rest}</div>`);
  return parts.join("") || `<div class="output-empty">No reviewer output yet.</div>`;
}


function renderTestCases(cases) {
  return cases.map((tc) => {
    const typeCls = tc.type.includes("happy") ? "happy" : tc.type.includes("edge") ? "edge" : "negative";
    return `<div class="tc-row">
      <div class="tc-row-head">
        <span class="tc-row-id">${escapeHtml(tc.id)}</span>
        <span class="tc-type tc-type-${typeCls}">${escapeHtml(tc.type.replace("_", " "))}</span>
        <strong style="font-size:.8rem">${escapeHtml(tc.title)}</strong>
      </div>
      <div style="font-size:.78rem;color:var(--muted);line-height:1.5">
        <div><strong style="color:var(--text)">Given</strong> ${escapeHtml(tc.given)}</div>
        <div><strong style="color:var(--text)">When</strong> ${escapeHtml(tc.when)}</div>
        <div><strong style="color:var(--text)">Then</strong> ${escapeHtml(tc.then)}</div>
        <div style="margin-top:.3rem;font-family:monospace;font-size:.72rem">✓ ${escapeHtml(tc.expected_evidence)}</div>
      </div>
    </div>`;
  }).join("");
}


function renderTestDataOutput(data) {
  if (data?.blocked) {
    return `<div class="output-kv-item validator" style="margin-bottom:.65rem;border-color:#fca5a5">
      <div class="output-kv-key">Blocked</div>
      <div class="output-kv-val validation-fail">${escapeHtml(data.blocked_reason || "Human input required before test data extraction.")}</div>
    </div>`;
  }
  const header = data.api_endpoint
    ? `<div class="output-kv-item validator" style="margin-bottom:.65rem"><div class="output-kv-key">Extracted from API</div><div class="output-kv-val"><strong>${escapeHtml(data.api_endpoint)}</strong><br><span style="font-size:.72rem;color:var(--muted)">Source: ${escapeHtml(data.source || "curl")}</span></div></div>`
    : data.source
      ? `<div style="font-size:.72rem;color:var(--muted);margin-bottom:.5rem">Source: ${escapeHtml(data.source)}</div>`
      : "";
  const rows = (data.datasets || []).map((d) =>
    `<div class="tc-row">
      <div class="tc-row-head"><span class="tc-row-id">${escapeHtml(d.test_case_id)}</span><span class="tc-type tc-type-happy" style="font-size:.65rem">${escapeHtml(d.test_case_type || "")}</span></div>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:.25rem"><strong>${escapeHtml(d.test_case_title || d.mapped_ac || "")}</strong>${d.ac_index ? ` · AC #${d.ac_index}` : ""}${d.requirement_id ? ` · ${escapeHtml(d.requirement_id)}` : ""}</div>
      ${d.requirement_text ? `<div style="font-size:.7rem;color:var(--muted);margin-bottom:.25rem">Req: ${escapeHtml(d.requirement_text)}</div>` : ""}
      <div style="font-size:.72rem;color:var(--muted);line-height:1.5">
        ${d.curl_template ? `<div><strong>API</strong> ${escapeHtml(d.curl_template)}</div>` : ""}
        <div><strong>Valid</strong> ${escapeHtml(JSON.stringify(d.valid_input))}</div>
        <div><strong>Invalid</strong> ${escapeHtml(JSON.stringify(d.invalid_input))}</div>
        <div><strong>Boundary</strong> ${escapeHtml(JSON.stringify(d.boundary_input))}</div>
        ${d.test_oracle ? `<div style="margin-top:.35rem;padding:.4rem .5rem;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px"><strong>Test oracle</strong> (${escapeHtml(d.test_oracle.scenario_role || d.scenario_role || "")})<div style="font-size:.7rem;margin-top:.25rem;line-height:1.45"><div><strong>Then</strong> ${escapeHtml(d.test_oracle.expected_behavior || "")}</div><div><strong>Pass</strong> ${escapeHtml(d.test_oracle.pass_criteria || "")}</div><div><strong>Fail</strong> ${escapeHtml(d.test_oracle.fail_criteria || "")}</div></div></div>` : ""}
        ${d.scenario_role ? `<div><strong>Primary scenario</strong> ${escapeHtml(d.scenario_role)}</div>` : ""}
      </div>
    </div>`
  ).join("");
  return `${header}<div class="output-kv">${renderKv("rows_extracted", data.rows_extracted)}${renderKv("fixtures", data.fixtures)}${renderKv("environment_variables", data.environment_variables)}</div><h4 style="font-size:.75rem;color:var(--muted);margin:.75rem 0 .5rem;text-transform:uppercase">Datasets</h4>${rows}`;
}


function renderTestExecutorOutput(data) {
  if (data?.blocked) {
    return `<div class="output-kv-item validator" style="margin-bottom:.65rem;border-color:#fca5a5">
      <div class="output-kv-key">Execution blocked</div>
      <div class="output-kv-val validation-fail">${escapeHtml(data.blocked_reason || "Provide required human input before execution.")}</div>
    </div>
    <div class="output-kv">${renderKv("execution_mode", data.execution_mode)}${renderKv("summary", `${data.summary?.blocked || 0} blocked · ${data.summary?.executed || 0} executed`)}</div>`;
  }
  const plan = (data.execution_plan || []).map((r) =>
    `<div class="tc-row"><div class="tc-row-head"><span class="tc-row-id">${escapeHtml(r.test_case_id)}</span><span class="tc-type tc-type-happy">${escapeHtml(r.method)}</span><span style="font-size:.72rem;color:var(--muted)">${escapeHtml(r.data_source)}</span></div></div>`
  ).join("");
  const results = (data.results || []).map((r) =>
    `<div class="tc-row"><div class="tc-row-head"><span class="tc-row-id">${escapeHtml(r.test_case_id)}</span><span class="tc-type ${r.status === "passed" ? "tc-type-happy" : "tc-type-edge"}">${escapeHtml(r.status)}</span></div><div style="font-size:.72rem;color:var(--muted)">${escapeHtml(r.evidence)}</div></div>`
  ).join("");
  const apiBlock = data.requires_human_api && data.human_api?.ok
    ? (() => {
        const api = data.human_api;
        return `<div class="output-kv-item validator" style="margin-bottom:.65rem"><div class="output-kv-key">Human-provided curl</div><div class="output-kv-val"><div style="font-size:.78rem;line-height:1.5"><strong>${escapeHtml(api.method)}</strong> ${escapeHtml(api.url || api.base_url + api.endpoint)}<br>${api.auth ? `<span style="color:var(--muted)">Auth:</span> [REDACTED]<br>` : ""}${Object.keys(api.headers || {}).length ? `<span style="color:var(--muted)">Headers:</span> ${escapeHtml(Object.keys(api.headers).join(", "))}` : ""}${api.body ? `<br><span style="color:var(--muted)">Body:</span> <code style="font-size:.7rem">${escapeHtml(redactString(api.body))}</code>` : ""}</div></div></div>`;
      })()
    : "";
  const s = data.summary || {};
  return `${apiBlock}<div class="output-kv">${renderKv("execution_mode", data.execution_mode)}${renderKv("summary", `Planned ${s.planned} · Executed ${s.executed} · Passed ${s.passed}`)}</div><h4 style="font-size:.75rem;color:var(--muted);margin:.75rem 0 .5rem;text-transform:uppercase">Execution plan</h4>${plan}<h4 style="font-size:.75rem;color:var(--muted);margin:.75rem 0 .5rem;text-transform:uppercase">Results</h4>${results}`;
}


function renderTicketPanel(story) {
  const panelLabel = el("ticket-panel-label");
  if (panelLabel) {
    panelLabel.textContent = story.from_requirements ? "Requirements" : story.from_jira ? "Live ticket" : "Story";
  }
  el("chip-status").textContent = "Status: " + (story.status || "—");
  el("chip-priority").textContent = "Priority: " + (story.priority || "—");
  el("chip-type").textContent = "Type: " + (story.issueType || "—");
  el("chip-components").textContent = "Component: " + ((story.components || []).join(", ") || "—");
  el("ticket-description").textContent = story.description || "(no description)";
  const acUl = el("ticket-ac");
  const acItems = story.acceptance_criteria_list || [];
  const rejected = story.acceptance_criteria_rejected || [];
  const meta = story.requirements_metadata || {};
  const metaNote = [
    meta.use_case ? `Use case: ${meta.use_case}` : null,
    meta.environment ? `Environment: ${meta.environment}` : null,
  ].filter(Boolean);
  acUl.innerHTML = acItems.length
    ? `<li class="muted" style="margin-bottom:.35rem;font-size:.72rem">Testable acceptance criteria (${acItems.length})</li>`
      + acItems.map((a, i) => `<li><strong>AC-${i + 1}.</strong> ${escapeHtml(a)}</li>`).join("")
      + (rejected.length
        ? `<li class="muted" style="margin-top:.65rem;font-size:.72rem">Excluded (${rejected.length}) — metadata, section headers, flow steps</li>`
          + rejected.map((r) => `<li class="muted" style="font-size:.72rem">${escapeHtml(r.text)}</li>`).join("")
        : "")
      + (metaNote.length
        ? `<li class="muted" style="margin-top:.35rem">${metaNote.map((m) => escapeHtml(m)).join(" · ")}</li>`
        : "")
    : (rejected.length
      ? `<li class="muted">No testable acceptance criteria</li>`
        + rejected.map((r) => `<li class="muted" style="font-size:.72rem">Excluded: ${escapeHtml(r.text)}</li>`).join("")
      : "<li class='muted'>No acceptance criteria parsed — check description format</li>");
}


function renderValidatorOutput(data) {
  if (!data) return `<div class="output-empty">Validator waiting for agent output…</div>`;
  const rows = (data.validations || []).map((v) =>
    `<div class="tc-row">
      <div class="tc-row-head">
        <span class="tc-row-id">#${v.step}</span>
        <span class="tc-type ${v.passed ? "tc-type-happy" : "tc-type-negative"}">${v.passed ? "PASS" : "FAIL"}</span>
        <strong style="font-size:.8rem">${escapeHtml(AGENT_META[v.target_agent]?.label || v.target_agent)}</strong>
        <span style="font-size:.72rem;color:var(--muted);margin-left:auto">${escapeHtml(v.score || "")}</span>
      </div>
      <div style="font-size:.75rem;color:var(--muted);line-height:1.5">${escapeHtml(v.message)}</div>
      ${v.failures?.length ? `<div style="font-size:.72rem;color:#dc2626;margin-top:.25rem">✗ ${escapeHtml(v.failures.join(" · "))}</div>` : ""}
      ${v.recommendation && !v.passed ? `<div style="font-size:.72rem;color:var(--text-secondary);margin-top:.25rem">→ ${escapeHtml(v.recommendation)}</div>` : ""}
      ${v.resolution ? `<div style="font-size:.72rem;color:var(--pass);margin-top:.25rem;border-top:1px dashed var(--border);padding-top:.25rem">↳ ${escapeHtml(v.resolution)}</div>` : ""}
    </div>`
  ).join("");
  return `
    <div class="output-kv">
      ${renderKv("max_attempts_per_agent", data.max_attempts_per_agent)}
      ${renderKv("validations_performed", data.validations_performed)}
      ${renderKv("passed", data.passed)}
      ${renderKv("failed", data.failed)}
      ${data.brake_applied ? renderKv("brake_applied", "Yes — run aborted after 2nd failure") : ""}
      ${renderKv("purpose", data.purpose)}
      ${renderKv("own_guidelines", data.own_guidelines)}
    </div>
    <h4 style="font-size:.72rem;color:var(--muted);margin:.75rem 0 .4rem;text-transform:uppercase">Validation history</h4>
    ${rows || '<div class="muted" style="font-size:.78rem">No validations yet</div>'}`;
}


function renderWebPreview(parsed) {
  const preview = el("human-web-preview");
  if (!preview) return;
  if (parsed?.ok) {
    preview.hidden = false;
    preview.textContent = `${parsed.title}\n${parsed.url}`;
  } else {
    preview.hidden = true;
    preview.textContent = "";
  }
}


function reset() {
  stopPlay();
  clearOrchestratorInactivityTimer();
  pausedForHumanInput = false;
  AGENT_ROLES.forEach(r => {
    const s = document.getElementById("status-" + r);
    if (s) s.textContent = "idle";
  });
  const vs = document.getElementById("status-validator");
  if (vs) vs.textContent = "idle";
  el("status-orchestrator").textContent = "ready";
  idx = -1;
  el("step-idx").textContent = "0";
  el("event-title").textContent = "Press Play or Next to start";
  el("event-kind").textContent = "—";
  el("event-kind").className = "kind-badge";
  el("event-message").textContent = "Orchestrator leads the pipeline. Required setup must come from you — nothing is simulated before you provide it.";
  el("orch-memory").textContent = "(waiting…)";
  el("agent-context").textContent = "No agent active";
  el("agent-returns").textContent = "—";
  el("decision-box").hidden = true;
  el("feedback-panel").hidden = true;
  el("event-log").innerHTML = "";
  el("human-input-panel") && (el("human-input-panel").hidden = true);
  document.querySelectorAll(".agent-node").forEach(n => n.classList.remove("active", "pulse"));
  document.querySelectorAll(".wire").forEach(w => w.classList.remove("active"));
  initAgentOutputState();
  agentChangeLog = {};
  renderPipelineBar(null, new Set());
  el("stats-row").hidden = true;
  activeOutputTab = "orchestrator";
  updateReportHeaderButtons();
}


function resolveTicketInput(input) {
  const raw = (input || getJiraInput() || "").trim();
  const key = parseIssueKey(raw);
  if (!key) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : browseUrlForKey(key);
  return { key, url };
}


function resumeOrchestratorAfterHumanInput() {
  while (idx < EVENTS.length - 1) {
    const upcoming = EVENTS[idx + 1];
    if (upcoming.kind === "human_input_request") break;
    showEvent(idx + 1);
    if (upcoming.kind === "agent_assign" && upcoming.role === "test_executor") break;
  }
  const need = getLiveHumanInputNeed(currentStory);
  const parts = [];
  if (need.types.includes("api") && humanApiInput.ok) parts.push("API curl");
  if (need.types.includes("webpage") && humanWebpageInput.ok) parts.push("webpage");
  setHumanInputStatus("ok", `${parts.join(" + ")} accepted — extracting test data`);
  if (pausedForHumanInput) {
    pausedForHumanInput = false;
    startPlay();
  }
}


function sanitizeLogFilename(s) {
  return String(s || "run").replace(/[^\w.-]+/g, "-").slice(0, 48);
}


function setActive(role) {
  document.querySelectorAll(".agent-node").forEach(n => n.classList.remove("active", "pulse"));
  document.querySelectorAll(".wire").forEach(w => w.classList.remove("active"));
  el("node-orchestrator").classList.add("active");
  if (role === "orchestrator") return;
  if (role) {
    const node = document.getElementById("agent-" + role);
    const wire = document.getElementById("wire-" + role);
    if (node) node.classList.add("active", "pulse");
    if (wire) wire.classList.add("active");
  }
}


/**
 * Publish an agent payload into the human-visible Agent outputs panel.
 * Prefer live agent_returns from the event; fall back to storyOutputs.
 */
function publishAgentOutputForHuman(role, payload, status = "done") {
  if (!role || payload == null || typeof payload !== "object") return;
  agentOutputs[role] = payload;
  if (storyOutputs && role !== "validator" && role !== "orchestrator") {
    storyOutputs[role] = payload;
  }
  setAgentOutputStatus(role, status);
}

function setAgentOutputStatus(role, status) {
  agentStatuses[role] = status;
  const tab = document.querySelector(`.output-tab[data-agent="${role}"]`);
  if (tab) {
    tab.classList.toggle("done", status === "done");
  }
}


function setHumanInputStatus(state, text) {
  const node = el("human-api-status");
  if (!node) return;
  node.className = "jira-status " + (state === "ok" ? "ok" : state === "err" ? "err" : "loading");
  node.textContent = text;
}

const setHumanApiStatus = setHumanInputStatus;


function setInputSource(source) {
  currentInputSource = source === "requirements" ? "requirements" : "jira";
  const isJira = currentInputSource === "jira";
  el("tab-source-jira")?.classList.toggle("active", isJira);
  el("tab-source-requirements")?.classList.toggle("active", !isJira);
  el("tab-source-jira")?.setAttribute("aria-selected", isJira ? "true" : "false");
  el("tab-source-requirements")?.setAttribute("aria-selected", !isJira ? "true" : "false");
  if (el("panel-jira-input")) el("panel-jira-input").hidden = !isJira;
  if (el("panel-requirements-input")) el("panel-requirements-input").hidden = isJira;
}


function setJiraStatus(state, text) {
  const node = el("jira-status");
  node.className = "jira-status " + state;
  node.textContent = text;
}


function setRequirementsLoadStatus(state, text) {
  const node = el("requirements-load-status");
  if (!node) return;
  node.className = "jira-status " + (state || "");
  node.textContent = text || "";
  node.style.display = text ? "inline-block" : "none";
}


function showEmptyTicketState() {
  stopPlay();
  reset();
  currentStory = null;
  EVENTS = [];
  storyOutputs = {};
  el("story-title").textContent = "Load a JIRA ticket or paste requirements";
  el("story-meta").textContent = "No story loaded";
  el("step-total").textContent = "0";
  el("ticket-description").textContent = "Use JIRA ticket or paste a requirements description on the left.";
  el("ticket-ac").innerHTML = "";
  if (el("ticket-panel-label")) el("ticket-panel-label").textContent = "Story";
  el("chip-status").textContent = "—";
  el("chip-priority").textContent = "—";
  el("chip-type").textContent = "—";
  el("chip-components").textContent = "—";
  el("prerequisites-panel") && (el("prerequisites-panel").hidden = true);
  el("human-input-panel") && (el("human-input-panel").hidden = true);
  setRequirementsLoadStatus("", "");
  document.title = "QA Agent Farm — Simulator";
}


function showEvent(i) {
  if (i < 0 || i >= EVENTS.length) return;
  idx = i;
  const e = enrichEventForDisplay(EVENTS[i]);
  el("step-idx").textContent = i + 1;
  el("event-title").textContent = kindLabel(e.kind) + (e.role ? " · " + e.role : "");
  const badge = el("event-kind");
  badge.textContent = e.kind;
  badge.className = "kind-badge " + kindClass(e.kind);
  el("event-message").textContent = e.message;
  el("orch-memory").textContent = renderDict(e.orchestrator_memory);

  if (e.kind === "agent_assign" || e.kind === "agent_return") {
    el("agent-panel-title").textContent = "🤖 " + e.role + (e.kind === "agent_assign" ? " · receives instructions" : " · returns feedback");
    el("agent-context").textContent = e.kind === "agent_assign" ? renderDict(e.agent_context) : "(task complete)";
    el("agent-returns").textContent = e.kind === "agent_return" ? renderDict(e.agent_returns) : "—";
    setActive(e.role);
    const statusEl = document.getElementById("status-" + e.role);
    if (statusEl) statusEl.textContent = e.kind === "agent_assign" ? "working…" : "done";
    if (e.kind === "agent_assign") {
      setAgentOutputStatus(e.role, "working");
      activeOutputTab = e.role;
      renderOutputTabs();
      renderActiveOutputTab();
    }
    if (e.kind === "agent_return" && !e.structured_output && e.output_note) {
      el("agent-returns").textContent = renderDict(e.agent_returns) + "\n\n⚠ " + e.output_note;
    }
    if (e.kind === "agent_return" && e.role) {
      // Always surface the return payload on the Agent outputs tab for the human.
      const live = e.agent_returns && Object.keys(e.agent_returns).length
        ? e.agent_returns
        : storyOutputs?.[e.role];
      publishAgentOutputForHuman(e.role, live, "done");
      activeOutputTab = e.role;
      renderOutputTabs();
      renderActiveOutputTab();
    }
  } else if (e.kind === "validator_assign" || e.kind === "validator_return") {
    const target = e.target_agent || "worker";
    el("agent-panel-title").textContent = e.kind === "validator_assign"
      ? "✅ Validator · checking " + target + " output"
      : "✅ Validator · " + (e.passed ? "PASSED" : "FAILED") + " for " + target;
    el("agent-context").textContent = e.kind === "validator_assign"
      ? renderDict(e.agent_context)
      : renderDict(e.validation || e.agent_returns);
    el("agent-returns").textContent = e.kind === "validator_return" ? renderDict(e.agent_returns) : "—";
    setActive("validator");
    const vStatus = document.getElementById("status-validator");
    if (vStatus) vStatus.textContent = e.kind === "validator_assign" ? "checking…" : (e.passed ? "passed" : "failed");
    activeOutputTab = "validator";
    if (e.kind === "validator_assign") {
      // Show the worker payload under review so the human can inspect it.
      const underReview = e.agent_context?.agent_output || storyOutputs?.[e.target_agent];
      if (underReview && e.target_agent) {
        publishAgentOutputForHuman(e.target_agent, underReview, agentStatuses[e.target_agent] || "done");
      }
      setAgentOutputStatus("validator", "working");
    }
    if (e.kind === "validator_return") {
      setAgentOutputStatus("validator", e.passed ? "done" : "working");
    }
    renderOutputTabs();
    renderActiveOutputTab();
  } else if (e.kind === "prerequisite_input_request" || e.kind === "prerequisite_input_received") {
    const check = e.prerequisite_need || getPrerequisiteCheck(currentStory);
    const actions = e.orchestrator_actions || e.agent_context?.orchestrator_actions || [];
    if (e.kind === "prerequisite_input_request") {
      pipelineState = e.pipeline_state || "WAITING_ON_HUMAN";
      blockingOrchestratorActions = (actions.length ? actions : []).map((a) => ({ ...a, resolved: false }));
    } else {
      pipelineState = e.pipeline_state || "READY_FOR_WRITER";
    }
    el("agent-panel-title").textContent = e.kind === "prerequisite_input_request"
      ? (pipelineState === "NEEDS_INPUT"
        ? `👤 Human · NEEDS_INPUT — provide testable ACs`
        : pipelineState === "WAITING_ON_HUMAN"
          ? `👤 Human · WAITING_ON_HUMAN (${blockingOrchestratorActions.length || check.items?.length || 0})`
          : `👤 Human · provide ${check.items.length} prerequisite(s)`)
      : "👤 Human · resolved — continue to Agent 2";
    el("agent-context").textContent = renderDict(e.agent_context);
    el("agent-returns").textContent = renderDict(e.agent_returns);
    setActive("orchestrator");
    el("status-orchestrator").textContent = e.kind === "prerequisite_input_request"
      ? (pipelineState === "NEEDS_INPUT"
        ? "NEEDS_INPUT"
        : pipelineState === "WAITING_ON_HUMAN" ? "WAITING_ON_HUMAN" : "awaiting prerequisites")
      : "prerequisites received";
    activeOutputTab = "orchestrator";
    updatePrerequisitesPanel(currentStory, {
      prerequisiteNeed: check,
      forceShow: e.kind === "prerequisite_input_request",
      orchestratorActions: blockingOrchestratorActions,
      pipelineState,
    });
    if (e.kind === "prerequisite_input_request") {
      if (playing) pausedForHumanInput = true;
      stopPlay();
      el("prerequisites-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } else if (e.kind === "human_input_request" || e.kind === "human_input_received") {
    const need = e.human_input_need || getLiveHumanInputNeed(currentStory);
    const ask = humanInputTypeLabel(need.types);
    el("agent-panel-title").textContent = e.kind === "human_input_request"
      ? `👤 Human · provide ${ask}`
      : `👤 Human · ${ask} received`;
    el("agent-context").textContent = renderDict(e.agent_context);
    el("agent-returns").textContent = renderDict(e.agent_returns);
    setActive("orchestrator");
    el("status-orchestrator").textContent = e.kind === "human_input_request"
      ? orchestratorAwaitingLabel(need)
      : "human input received";
    activeOutputTab = "orchestrator";
    updateHumanInputPanel(currentStory, { forceShow: e.kind === "human_input_request", humanInputNeed: need });
    if (e.kind === "human_input_request") {
      if (playing) pausedForHumanInput = true;
      stopPlay();
      el("human-input-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (isHumanInputSatisfied(need)) {
        clearOrchestratorInactivityTimer();
        setHumanInputStatus("ok", `${humanInputTypeLabel(need.types)} ready — click Next or Provide input`);
      } else {
        startOrchestratorInactivityTimer();
      }
    } else {
      clearOrchestratorInactivityTimer();
    }
  } else if (e.kind === "orchestrator_inactivity_timeout") {
    el("agent-panel-title").textContent = "⏱ Orchestrator · inactivity timeout";
    el("agent-context").textContent = renderDict(e.agent_context);
    el("agent-returns").textContent = renderDict(e.agent_returns);
    setActive("orchestrator");
    el("status-orchestrator").textContent = "inactive — run failed";
    activeOutputTab = "orchestrator";
    clearOrchestratorInactivityTimer();
  } else if (e.kind === "orchestrator_instruct" || e.kind === "orchestrator_reinstruct" || e.kind === "orchestrator_gate" || e.kind === "orchestrator_abort" || e.kind === "orchestrator_receive" || e.kind === "orchestrator_stage") {
    const titles = {
      orchestrator_instruct: "🎯 Orchestrator · sending instructions",
      orchestrator_reinstruct: "🎯 Orchestrator · re-instructing " + (e.target_agent || "agent") + " (1 retry left)",
      orchestrator_gate: "🎯 Orchestrator · gate passed for " + (e.target_agent || "agent"),
      orchestrator_abort: "🎯 Orchestrator · halting run",
      orchestrator_receive: "🎯 Orchestrator · received feedback",
      orchestrator_stage: "🎯 Orchestrator · stage 1",
    };
    el("agent-panel-title").textContent = titles[e.kind] || "🎯 Orchestrator";
    el("agent-context").textContent = e.kind === "orchestrator_instruct" || e.kind === "orchestrator_reinstruct"
      ? renderDict(e.instructions || e.agent_context)
      : e.kind === "orchestrator_gate"
        ? renderDict(e.validation_feedback || e.agent_returns)
        : e.kind === "orchestrator_receive"
          ? renderDict(e.feedback || e.agent_returns)
          : "Validating ticket and planning pipeline";
    el("agent-returns").textContent = (e.kind === "orchestrator_receive" || e.kind === "orchestrator_gate" || e.kind === "orchestrator_reinstruct")
      ? renderDict(e.agent_returns || e.validation_feedback) : "—";
    setActive("orchestrator");
    el("status-orchestrator").textContent = e.kind === "orchestrator_abort" ? "run halted"
      : e.kind === "orchestrator_reinstruct" ? "re-instructing…"
      : e.kind === "orchestrator_gate" ? "advancing pipeline"
      : e.kind === "orchestrator_receive" ? "feedback received"
      : e.kind === "orchestrator_instruct" ? "instructing…" : "leading";
    activeOutputTab = "orchestrator";
  } else if (e.kind === "pipeline_hold") {
    el("agent-panel-title").textContent = "⏸ Pipeline hold · " + (e.target_agent || "upstream") + " not validated";
    el("agent-context").textContent = renderDict(e.agent_context);
    el("agent-returns").textContent = renderDict(e.agent_returns);
    setActive("orchestrator");
    el("status-orchestrator").textContent = "hold — downstream blocked";
    // Keep the blocked agent's output visible for the human.
    const held = e.agent_context?.agent_output || e.agent_returns;
    if (e.target_agent && held) {
      publishAgentOutputForHuman(e.target_agent, held, "done");
      activeOutputTab = e.target_agent;
    } else {
      activeOutputTab = "orchestrator";
    }
    renderOutputTabs();
    renderActiveOutputTab();
    stopPlay();
  } else if (e.kind === "validator_brake" || e.kind === "run_failed") {
    el("agent-panel-title").textContent = e.kind === "validator_brake"
      ? "✅ Validator · brake applied"
      : "🛑 Run failed";
    el("agent-context").textContent = e.kind === "validator_brake"
      ? renderDict(e.agent_context || e.validation)
      : renderDict(e.agent_returns);
    el("agent-returns").textContent = renderDict(e.agent_returns);
    setActive(e.kind === "validator_brake" ? "validator" : "orchestrator");
    if (e.kind === "validator_brake") {
      const vStatus = document.getElementById("status-validator");
      if (vStatus) vStatus.textContent = "brake";
      activeOutputTab = "validator";
    } else {
      el("status-orchestrator").textContent = "failed";
      activeOutputTab = "orchestrator";
    }
  } else {
    el("agent-panel-title").textContent = "🤖 Agent context";
    el("agent-context").textContent = e.kind.startsWith("agent") ? renderDict(e.agent_context) : "Orchestrator phase — no subagent handoff";
    el("agent-returns").textContent = renderDict(e.agent_returns);
    setActive("orchestrator");
    el("status-orchestrator").textContent = e.phase || "active";
    activeOutputTab = "orchestrator";
  }

  const dec = el("decision-box");
  if (e.decision) {
    dec.hidden = false;
    el("decision-text").textContent = e.decision;
  } else {
    dec.hidden = true;
  }

  const log = el("event-log");
  log.innerHTML = EVENTS.slice(0, i + 1).reverse().map((ev, j) => {
    const n = i - j;
    return `<div class="log-item ${n === i ? "current" : ""}"><span class="log-num">${n + 1}</span> <strong>${kindLabel(ev.kind)}</strong> ${ev.role ? "· " + ev.role : ""}<br><span class="muted">${ev.message}</span></div>`;
  }).join("");

  syncOrchestratorOutput(i);
  syncOutputsToIndex(i);
  if (e.kind === "run_end" || (e.kind === "orchestrator_gate" && e.target_agent === "reporter")) {
    focusReportTabIfReady();
    renderOutputTabs();
    renderActiveOutputTab();
  }
  renderEventFeedbackClarification(e, i);

  const activeRole = (e.kind === "validator_assign" || e.kind === "validator_return") ? "validator"
    : (e.kind === "agent_assign" || e.kind === "agent_return") ? e.role
    : "orchestrator";
  renderPipelineBar(activeRole, getDoneRolesUpTo(i));
  updateStats(i);
  updateHumanInputPanel(currentStory);
}


function startDefaultPipeline() {
  currentRunOptions = {};
  const url = new URL(location.href);
  url.searchParams.delete("demo");
  url.searchParams.delete("abort_demo");
  if (currentInputSource === "requirements") {
    url.searchParams.delete("ticket");
    history.replaceState(null, "", url);
  }
  startPipelineFromActiveSource({});
}

el("btn-demo-requirements")?.addEventListener("click", startRequirementsDemo);
el("btn-demo-default")?.addEventListener("click", startDefaultPipeline);
el("demo-exit-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  startDefaultPipeline();
});

(async function init() {
  try {
    renderPipelineBar(null, new Set());
    setInputSource("jira");
    await checkJiraHealth();
    const params = new URLSearchParams(location.search);
    const demo = params.get("demo") === "requirements" || params.get("abort_demo") === "1"
      ? "requirements"
      : null;
    currentRunOptions = demo ? { demo } : {};
    const source = params.get("source");
    if (source === "requirements") {
      setInputSource("requirements");
      try {
        const saved = sessionStorage.getItem("qa-last-requirements");
        if (saved && el("req-description") && !el("req-description").value.trim()) {
          el("req-description").value = saved;
        }
      } catch { /* ignore */ }
      showEmptyTicketState();
      el("event-message").textContent = "Paste your requirements description on the left, then click Load & run pipeline.";
      return;
    }
    const initial = params.get("ticket") || params.get("url") || params.get("key") || getJiraInput();
    if (initial && resolveTicketInput(initial)) {
      await loadStoryByKey(initial, !demo, currentRunOptions);
    } else {
      showEmptyTicketState();
    }
  } catch (err) {
    console.error("Simulator init failed:", err);
    setJiraStatus("err", "init failed");
    el("server-banner").hidden = false;
    el("event-message").textContent = "Simulator failed to start: " + (err.message || String(err));
  }
})();

function startOrchestratorInactivityTimer() {
  if (!isBlockingOrchestratorWait(idx)) return;
  clearOrchestratorInactivityTimer();
  orchestratorInactivityDeadline = Date.now() + ORCHESTRATOR_INACTIVITY_TIMEOUT_MS;
  updateOrchestratorInactivityCountdownUI();
  orchestratorInactivityCountdownInterval = setInterval(updateOrchestratorInactivityCountdownUI, 1000);
  orchestratorInactivityTimer = setTimeout(handleOrchestratorInactivityTimeout, ORCHESTRATOR_INACTIVITY_TIMEOUT_MS);
  const need = getLiveHumanInputNeed(currentStory);
  setHumanInputStatus("loading", `orchestrator waiting for ${waitingForHumanInputDescription(need)} — 1 min limit`);
}


async function startPipelineFromActiveSource(runOptions) {
  if (currentInputSource === "requirements") {
    try {
      await loadRequirementsFromForm(runOptions);
    } catch (err) {
      setRequirementsLoadStatus("err", err.message);
      alert(err.message);
    }
    return;
  }
  const resolved = resolveTicketInput(currentStory?.jira || getJiraInput());
  if (!resolved) {
    alert("Paste a JIRA URL first, or switch to Requirements and paste your description.");
    return;
  }
  const url = new URL(location.href);
  url.searchParams.delete("demo");
  url.searchParams.delete("abort_demo");
  url.searchParams.set("ticket", resolved.url);
  history.replaceState(null, "", url);
  if (currentStory && !currentStory.from_requirements) {
    try {
      await ensureAgent1(currentStory, runOptions);
    } catch (err) {
      alert(err.message);
      return;
    }
    loadStory(currentStory, runOptions);
  } else {
    loadStoryByKey(resolved.url, location.protocol !== "file:" && !runOptions?.demo, runOptions);
  }
}


function startPlay() {
  if (isWaitingForPrerequisites(idx)) {
    promptForPrerequisites();
    return;
  }
  if (isWaitingForHumanInput(idx)) {
    const need = getLiveHumanInputNeed(currentStory);
    updateHumanInputPanel(currentStory, { forceShow: true, humanInputNeed: need });
    setHumanInputStatus("err", need.action || `complete ${humanInputTypeLabel(need.types)} first`);
    return;
  }
  if (isExecutionPhaseBlocked(idx)) {
    promptForRequiredInput();
    return;
  }
  if (idx < 0) showEvent(0);
  playing = true;
  el("btn-play").innerHTML = '<i class="ti ti-player-pause" id="play-icon"></i> Pause';
  const ms = parseInt(el("speed").value, 10);
  timer = setInterval(() => {
    if (idx >= EVENTS.length - 1) stopPlay();
    else next();
  }, ms);
}


async function startRequirementsDemo() {
  currentRunOptions = { demo: "requirements" };
  const url = new URL(location.href);
  url.searchParams.set("demo", "requirements");
  url.searchParams.delete("abort_demo");
  if (currentInputSource === "requirements") {
    url.searchParams.delete("ticket");
    history.replaceState(null, "", url);
    try {
      await loadRequirementsFromForm(currentRunOptions);
    } catch (err) {
      setRequirementsLoadStatus("err", err.message);
    }
    return;
  }
  const resolved = resolveTicketInput(currentStory?.jira || getJiraInput());
  if (!resolved) {
    alert("Paste a JIRA URL or switch to Requirements tab.");
    return;
  }
  url.searchParams.set("ticket", resolved.url);
  history.replaceState(null, "", url);
  if (currentStory && !currentStory.from_requirements) {
    loadStory(currentStory, currentRunOptions);
  } else {
    loadStoryByKey(resolved.url, false, currentRunOptions);
  }
}

function stopPlay() {
  playing = false;
  el("btn-play").innerHTML = '<i class="ti ti-player-play" id="play-icon"></i> Play';
  if (timer) clearInterval(timer);
  timer = null;
}


function storyRequiresApi(story) {
  const need = story ? getLiveHumanInputNeed(story) : cachedHumanInputNeed;
  return !!(need?.types?.includes("api"));
}


function storyRequiresWebpage(story) {
  const need = story ? getLiveHumanInputNeed(story) : cachedHumanInputNeed;
  return !!(need?.types?.includes("webpage"));
}


function refreshExecutionOutputs() {
  if (!currentStory) return;
  const api = humanApiInput.ok ? humanApiInput : null;
  const web = humanWebpageInput.ok ? humanWebpageInput : null;
  const executor = buildTestExecutorOutput(currentStory, api, web, executionResult);
  storyOutputs.test_executor = executor;
  storyOutputs.reviewer = buildReviewerOutput(currentStory, currentStory.test_cases, executor);
  storyOutputs.reporter = buildReporterOutput(currentStory, storyOutputs.writer?.test_cases || [], executor);
  if (agentOutputs.test_executor) agentOutputs.test_executor = executor;
  if (agentOutputs.reviewer) agentOutputs.reviewer = storyOutputs.reviewer;
  if (agentOutputs.reporter) agentOutputs.reporter = storyOutputs.reporter;
}


async function runApiExecution(curlText) {
  try {
    const res = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ curl: curlText }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      executionResult = { executed: false, error: data.error || `HTTP ${res.status}` };
      return executionResult;
    }
    executionResult = data;
    return data;
  } catch (err) {
    executionResult = { executed: false, error: err.message };
    return executionResult;
  }
}


function submitHumanInput(advanceStep) {
  const need = getLiveHumanInputNeed(currentStory);
  if (!need.needsHumanInput) {
    setHumanInputStatus("err", "No human input required for current requirements");
    return false;
  }

  const finish = () => {
    clearOrchestratorInactivityTimer();
    syncHumanInputToOutputs();
    const parts = [];
    if (need.types.includes("api") && humanApiInput.ok) parts.push(`${humanApiInput.method} ${humanApiInput.endpoint}`);
    if (need.types.includes("webpage") && humanWebpageInput.ok) parts.push(humanWebpageInput.url);
    if (executionResult?.executed) parts.push(`HTTP ${executionResult.status ?? "error"}`);
    setHumanInputStatus("ok", parts.join(" · "));

    // Append Data→… only after human input; do not pre-build past the request.
    const alreadyHasData = EVENTS.some((e) => e?.kind === "agent_assign" && e.role === "test_data_extractor");
    if (!alreadyHasData && EVENTS[idx]?.kind === "human_input_request") {
      const more = buildEventsAfterHumanApiInput(
        currentStory,
        storyOutputs?.analyst,
        storyOutputs?.writer,
      );
      EVENTS = EVENTS.slice(0, idx + 1).concat(more);
      el("step-total").textContent = EVENTS.length;
    }

    if (advanceStep && EVENTS[idx]?.kind === "human_input_request" && idx < EVENTS.length - 1) {
      stopPlay();
      next();
      resumeOrchestratorAfterHumanInput();
    }
    renderActiveOutputTab();
    return true;
  };

  if (need.types.includes("api")) {
    const parsed = parseCurl(el("human-api-curl")?.value?.trim() || "");
    if (!parsed.ok) {
      setHumanInputStatus("err", parsed.error);
      renderCurlPreview(null);
      return false;
    }
    humanApiInput = parsed;
    renderCurlPreview(parsed);
    setHumanInputStatus("loading", "executing API request…");
    runApiExecution(parsed.curl).then(() => finish());
    return true;
  }

  if (need.types.includes("webpage")) {
    const web = parseWebpageInput(el("human-web-url")?.value, el("human-web-title")?.value);
    if (!web.ok) {
      setHumanInputStatus("err", web.error);
      renderWebPreview(null);
      return false;
    }
    humanWebpageInput = web;
    renderWebPreview(web);
  }

  return finish();
}

const submitHumanApi = submitHumanInput;


function submitPrerequisites() {
  updatePrerequisiteStatus();
  if (!isPrerequisitesSatisfied()) {
    promptForPrerequisites();
    return false;
  }
  const conditions = storyOutputs?.analyst?.testable_conditions || [];
  if (!conditions.length) {
    const status = el("prerequisites-status");
    if (status) {
      status.className = "jira-status err";
      status.textContent = "Blocked — zero testable ACs. Paste requirements with Business Rules / Alt / Exception flows, then re-run Agent 1.";
    }
    if (el("event-message")) {
      el("event-message").textContent = "INVALID_REQUIREMENTS — prerequisites cannot unlock Writer/Author without validated testable conditions.";
    }
    return false;
  }

  // Reviewer recheck: blame human answers against Analyst asks before unlocking Writer.
  const check = cachedPrerequisiteCheck || getPrerequisiteCheck(currentStory);
  const humanReview = reviewHumanInputAgainstAnalyst(storyOutputs?.analyst, {
    actions: blockingOrchestratorActions,
    prereqItems: check?.items || [],
    userPrerequisites,
    api: humanApiInput,
    webpage: humanWebpageInput,
  });
  storyOutputs.reviewer = {
    ...(storyOutputs.reviewer || {}),
    human_input_recheck: humanReview,
  };
  agentOutputs.reviewer = storyOutputs.reviewer;
  setAgentOutputStatus("reviewer", humanReview.passed ? "done" : "working");
  activeOutputTab = "reviewer";
  renderOutputTabs();
  renderActiveOutputTab();

  const status = el("prerequisites-status");
  if (!humanReview.passed) {
    pipelineState = "WAITING_ON_HUMAN";
    if (storyOutputs?.analyst) storyOutputs.analyst.pipeline_state = "WAITING_ON_HUMAN";
    if (status) {
      status.className = "jira-status err";
      status.textContent = humanReview.summary;
    }
    if (el("event-message")) {
      el("event-message").textContent = `Reviewer rejected human input — ${humanReview.failures.length} issue(s). Fix blamed fields and resubmit.`;
    }
    renderHumanInputRecheckBanner(humanReview);
    return false;
  }

  pipelineState = "READY_FOR_WRITER";
  const providedActions = blockingOrchestratorActions
    .filter((a) => (a.provided_value || "").trim().length > 0)
    .map((a) => ({
      action: a.action || "ACTION",
      target: a.target || "",
      detail: a.detail || "",
      value: a.provided_value.trim(),
    }));
  if (storyOutputs?.analyst) {
    storyOutputs.analyst.pipeline_state = "READY_FOR_WRITER";
    // Pass Agent 1 outputs into Agent 2 input channel
    const writerInput = storyOutputs.analyst.writer_input || {
      testable_conditions: storyOutputs.analyst.testable_conditions || [],
      prerequisites_needed: storyOutputs.analyst.prerequisites_needed || { blocking: [], non_blocking: [] },
    };
    // Capture any values the human typed for the blocking orchestrator actions.
    if (providedActions.length) {
      writerInput.human_provided_prerequisites = providedActions;
    }
    writerInput.human_input_recheck = humanReview;
    storyOutputs.analyst.writer_input = writerInput;
    if (storyOutputs.writer) {
      storyOutputs.writer.analyst_input = writerInput;
    }
  }
  if (status) {
    status.className = "jira-status ok";
    status.textContent = humanReview.summary;
  }
  if (el("event-message")) {
    el("event-message").textContent = "Reviewer accepted human input against Analyst needs — continuing to Writer.";
  }
  renderHumanInputRecheckBanner(humanReview);
  syncRequirementsToTestData();

  // Append Writer→… only after Analyst validated + human recheck accepted.
  const alreadyHasWriter = EVENTS.some((e) => e?.kind === "agent_assign" && e.role === "writer");
  if (!alreadyHasWriter) {
    const more = buildEventsAfterHumanPrerequisites(currentStory, storyOutputs?.analyst);
    const at = EVENTS[idx]?.kind === "prerequisite_input_request" ? idx : EVENTS.length - 1;
    EVENTS = EVENTS.slice(0, at + 1).concat(more);
    el("step-total").textContent = EVENTS.length;
  }

  if (EVENTS[idx]?.kind === "prerequisite_input_request" && idx < EVENTS.length - 1) {
    stopPlay();
    next();
  }
  return true;
}

function renderHumanInputRecheckBanner(review) {
  const host = el("prerequisites-list");
  if (!host || !review) return;
  const existing = host.querySelector(".human-input-recheck");
  if (existing) existing.remove();
  const failures = review.failures || [];
  const rows = (review.checks || []).map((c) => {
    const ok = c.status === "pass";
    return `<li style="font-size:.72rem;margin:.25rem 0;color:${ok ? "var(--success)" : "#b91c1c"}">
      <strong>${ok ? "PASS" : "FAIL"}</strong> — ${escapeHtml(c.asked_for || c.analyst_ref || "")}
      <br><span class="muted">Provided:</span> ${escapeHtml(String(c.provided || "").slice(0, 100))}
      ${c.blame ? `<br><span style="font-weight:600">Blame:</span> ${escapeHtml(c.blame)}` : ""}
    </li>`;
  }).join("");
  const banner = document.createElement("div");
  banner.className = "human-input-recheck";
  banner.style.cssText = `margin:.75rem 0;padding:.65rem .75rem;border-radius:8px;border:1px solid ${review.passed ? "#86efac" : "#fca5a5"};background:${review.passed ? "#f0fdf4" : "#fef2f2"}`;
  banner.innerHTML = `
    <div style="font-size:.78rem;font-weight:600;margin-bottom:.35rem">Reviewer · human input vs Analyst</div>
    <div style="font-size:.74rem;margin-bottom:.35rem">${escapeHtml(review.summary || "")}</div>
    ${failures.length ? `<div style="font-size:.72rem;color:#b91c1c;margin-bottom:.35rem">${failures.length} rejected — correct and resubmit.</div>` : ""}
    <ul style="margin:0;padding-left:1.1rem">${rows}</ul>
  `;
  host.prepend(banner);
}


function syncHumanInputToOutputs() {
  if (!currentStory) return;
  const need = getLiveHumanInputNeed(currentStory);
  if (!isHumanInputSatisfied(need)) return;
  syncRequirementsToTestData();
  refreshExecutionOutputs();
}

const syncHumanApiToOutputs = syncHumanInputToOutputs;


function syncOrchestratorOutput(i) {
  if (i < 0) {
    agentStatuses.orchestrator = "pending";
    delete agentOutputs.orchestrator;
    return;
  }
  agentOutputs.orchestrator = buildOrchestratorLiveState(i);
  const last = EVENTS[i];
  if (last?.kind === "run_end") {
    agentStatuses.orchestrator = "done";
  } else if (last?.kind === "run_failed") {
    agentStatuses.orchestrator = "done";
  } else if (i >= 0) {
    agentStatuses.orchestrator = "working";
  }
}


function syncOutputsToIndex(i) {
  syncValidatorOutput(i);
  syncHumanInputToOutputs();
  let requirementsTouched = false;
  agentChangeLog = {};
  for (let j = 0; j <= i; j++) {
    const ev = EVENTS[j];
    if (ev?.kind === "agent_return" && (ev.role === "writer" || ev.role === "analyst") && ev.structured_output) {
      requirementsTouched = true;
    }
    if (ev?.kind === "agent_return" && ev.is_retry && ev.changes_made?.length) {
      agentChangeLog[ev.role] = {
        changes: ev.changes_made,
        before: ev.before_output,
        after: ev.agent_returns,
        message: ev.message,
      };
    }
    if (ev?.kind === "agent_assign" && ev.role && ev.role !== "validator") {
      setAgentOutputStatus(ev.role, agentOutputs[ev.role] ? "done" : "working");
    }
    if (ev?.kind === "agent_return" && ev.role) {
      if (ev.role === "test_data_extractor" && currentStory && ev.structured_output) {
        storyOutputs.test_data_extractor = buildTestDataExtractorOutput(
          currentStory,
          humanApiInput.ok ? humanApiInput : null,
          storyOutputs.writer?.test_cases,
          storyOutputs.analyst,
          humanWebpageInput.ok ? humanWebpageInput : null,
        );
      }
      if (ev.role === "test_executor" && currentStory && ev.structured_output) {
        refreshExecutionOutputs();
      }
      // Prefer live event payload so humans always see what the agent just returned.
      const live = ev.agent_returns && Object.keys(ev.agent_returns).length
        ? ev.agent_returns
        : storyOutputs[ev.role];
      publishAgentOutputForHuman(ev.role, live, "done");
      if (ev.role === "reporter") {
        activeOutputTab = "reporter";
      }
    }
  }
  if (requirementsTouched) {
    syncRequirementsToTestData();
  }
  renderOutputTabs();
  renderActiveOutputTab();
  updateReportHeaderButtons();
}


function syncRequirementsToTestData() {
  if (!currentStory || !storyOutputs.writer?.test_cases?.length) return;
  rebuildHumanInputEventSlice();
  const rebuilt = buildTestDataExtractorOutput(
    currentStory,
    humanApiInput.ok ? humanApiInput : null,
    storyOutputs.writer.test_cases,
    storyOutputs.analyst,
    humanWebpageInput.ok ? humanWebpageInput : null,
  );
  storyOutputs.test_data_extractor = rebuilt;
  if (agentOutputs.test_data_extractor) {
    agentOutputs.test_data_extractor = rebuilt;
  }
  const need = getLiveHumanInputNeed(currentStory);
  if (isHumanInputSatisfied(need)) {
    refreshExecutionOutputs();
  }
  rebuildDataExtractorValidationGate();
  updateHumanInputPanel(currentStory);
}


function syncValidatorOutput(i) {
  if (i < 0) {
    agentStatuses.validator = "pending";
    delete agentOutputs.validator;
    return;
  }
  const live = buildValidatorLiveState(i);
  if (live?.validations_performed > 0) {
    agentOutputs.validator = live;
    agentStatuses.validator = i >= EVENTS.length - 1 || EVENTS[i]?.kind === "run_failed" ? "done" : "working";
  }
}


function triggerFileDownload(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}


function updateDemoBanner(runOptions) {
  const banner = el("demo-banner");
  const isDemo = runOptions?.demo === "requirements";
  if (banner) banner.hidden = !isDemo;
  const btnReq = el("btn-demo-requirements");
  const btnDef = el("btn-demo-default");
  if (btnReq) btnReq.classList.toggle("btn-primary", isDemo);
  if (btnDef) btnDef.classList.toggle("btn-primary", !isDemo);
}


function updateHumanInputPanel(story, options = {}) {
  const panel = el("human-input-panel");
  if (!panel) return;
  const need = options.humanInputNeed || getLiveHumanInputNeed(story);
  cachedHumanInputNeed = need;

  const waitingAtStep = options.forceShow || isWaitingForHumanInput(idx);
  panel.hidden = !need.needsHumanInput || !waitingAtStep;

  const head = el("human-input-head");
  const desc = el("human-input-desc");
  const apiSec = el("human-api-section");
  const webSec = el("human-web-section");
  const submitBtn = el("btn-submit-human-input");
  const statusEl = el("human-api-status");

  if (panel.hidden) {
    if (statusEl) statusEl.hidden = true;
    return;
  }

  const showApi = need.types.includes("api");
  const showWeb = need.types.includes("webpage");

  if (head) {
    head.innerHTML = showApi && !showWeb
      ? '<i class="ti ti-plug"></i> API curl needed'
      : showWeb && !showApi
        ? '<i class="ti ti-world"></i> Webpage URL needed'
        : '<i class="ti ti-user"></i> Your input needed';
  }
  if (desc) desc.textContent = describeHumanInputNeed(need);
  if (apiSec) apiSec.hidden = !showApi;
  if (webSec) webSec.hidden = !showWeb;
  if (submitBtn) {
    submitBtn.innerHTML = showApi && !showWeb
      ? '<i class="ti ti-send"></i> Confirm curl'
      : showWeb && !showApi
        ? '<i class="ti ti-send"></i> Confirm webpage URL'
        : '<i class="ti ti-send"></i> Confirm input';
  }

  if (showApi && humanApiInput.ok) renderCurlPreview(humanApiInput);
  if (showWeb && humanWebpageInput.ok) renderWebPreview(humanWebpageInput);

  if (statusEl) statusEl.hidden = false;
  if (isHumanInputSatisfied(need)) {
    setHumanInputStatus("ok", "input received");
  } else {
    setHumanInputStatus("loading", showApi && !showWeb ? "paste curl above" : showWeb && !showApi ? "enter webpage URL above" : "complete the fields above");
  }
}

const updateHumanApiPanel = updateHumanInputPanel;


function updateOrchestratorInactivityCountdownUI() {
  const node = el("human-api-countdown");
  if (!node) return;
  if (!orchestratorInactivityDeadline || !isBlockingOrchestratorWait(idx)) {
    node.hidden = true;
    return;
  }
  const left = orchestratorInactivityDeadline - Date.now();
  if (left <= 0) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  node.className = "jira-status loading";
  node.textContent = `orchestrator idle · fail in ${formatCountdown(left)}`;
}


function updatePrerequisiteStatus() {
  const status = el("prerequisites-status");
  if (!status) return;
  const check = cachedPrerequisiteCheck;
  if (!check?.needed) return;
  if (isPrerequisitesSatisfied()) {
    status.className = "jira-status ok";
    status.textContent = "Prerequisites confirmed — click Confirm or press Next";
  } else {
    status.className = "jira-status loading";
    status.textContent = "Orchestrator is waiting — fill in all fields";
  }
}


function updatePrerequisitesPanel(story, options = {}) {
  const panel = el("prerequisites-panel");
  if (!panel) return;
  const waitingAtStep = options.forceShow || EVENTS[idx]?.kind === "prerequisite_input_request";
  const check = options.prerequisiteNeed || getPrerequisiteCheck(story);
  cachedPrerequisiteCheck = check;
  const actions = options.orchestratorActions || blockingOrchestratorActions;
  const state = options.pipelineState || pipelineState;
  panel.hidden = !waitingAtStep || !(check.needed || actions.length || state === "WAITING_ON_HUMAN" || state === "NEEDS_INPUT");

  const list = el("prerequisites-list");
  const desc = el("prerequisites-desc");
  const storyMapEl = el("prerequisites-story-map");
  const reasoningEl = el("prerequisites-reasoning");
  const satisfiedWrap = el("prerequisites-satisfied-wrap");
  const satisfiedEl = el("prerequisites-satisfied");
  const submitBtn = el("btn-submit-prerequisites");

  if (desc) {
    desc.textContent = waitingAtStep
      ? (state === "NEEDS_INPUT"
        ? (check.summary || "INVALID_REQUIREMENTS — zero testable ACs. Re-paste requirements with Business Rules / Alt / Exception flows and re-run Agent 1.")
        : state === "WAITING_ON_HUMAN"
          ? (check.summary || "Analyst needs clarification — type answers for blocking asks, then continue to Agent 2.")
          : (check.summary || "Story analysis complete."))
      : (check.summary || "");
  }

  if (submitBtn) {
    submitBtn.innerHTML = state === "NEEDS_INPUT"
      ? `<i class="ti ti-ban"></i> Blocked — need testable ACs`
      : state === "WAITING_ON_HUMAN"
        ? `<i class="ti ti-player-play"></i> Resolved — continue pipeline`
        : `<i class="ti ti-check"></i> Confirm prerequisites`;
    submitBtn.disabled = state === "NEEDS_INPUT";
  }

  if (storyMapEl && check.story_analysis?.test_actions?.length && waitingAtStep) {
    storyMapEl.hidden = false;
    storyMapEl.innerHTML = `<div class="prereq-section-title" style="margin-top:0">From your user story</div>`
      + check.story_analysis.test_actions.map((t) =>
        `<div class="prereq-ac-row"><strong>${escapeHtml(t.ac)}</strong> "${escapeHtml(t.ac_text)}"<br><span class="prereq-for-ac">→ ${escapeHtml(t.action)}</span></div>`
      ).join("");
  } else if (storyMapEl) {
    storyMapEl.hidden = true;
    storyMapEl.innerHTML = "";
  }

  if (reasoningEl) {
    const steps = check.reasoning_steps || [];
    if (waitingAtStep && steps.length) {
      reasoningEl.hidden = false;
      reasoningEl.innerHTML = `<div class="prereq-section-title" style="margin-top:0">Analyst reasoning</div><ol>`
        + steps.map((s) =>
          `<li>${escapeHtml(s.text)}${s.cite ? `<cite>${escapeHtml(String(s.cite).slice(0, 120))}</cite>` : ""}</li>`
        ).join("")
        + `</ol>`;
    } else {
      reasoningEl.hidden = true;
      reasoningEl.innerHTML = "";
    }
  }

  if (satisfiedWrap && satisfiedEl) {
    const satisfied = check.already_satisfied || [];
    satisfiedWrap.hidden = !waitingAtStep || !satisfied.length;
    satisfiedEl.innerHTML = satisfied.map((item) =>
      `<div class="prereq-satisfied-item"><strong>${escapeHtml(item.label)}</strong> — ${escapeHtml(item.analyst_note || item.reason)}${item.evidence_in_ticket ? `<br><span style="opacity:.85">In ticket: ${escapeHtml(String(item.evidence_in_ticket).slice(0, 100))}</span>` : ""}</div>`
    ).join("");
  }

  if (panel.hidden) {
    prereqShowsApi = false;
    prereqShowsWeb = false;
    return;
  }

  if (list) {
    const actionChecklist = actions.length
      ? `<div class="prereq-section-title">Orchestrator actions — provide input or check off</div>`
        + actions.map((a, i) => `
      <div class="prereq-field" data-action-idx="${i}" style="border-left:3px solid #c4b5fd;padding-left:.6rem">
        <label style="display:flex;gap:.55rem;align-items:flex-start;cursor:pointer">
          <input type="checkbox" class="orch-action-check" data-idx="${i}" ${a.resolved ? "checked" : ""} style="margin-top:.25rem" />
          <span style="font-size:.78rem;line-height:1.45">
            <span style="display:inline-block;background:#1e293b;color:#fff;border-radius:4px;padding:.05rem .35rem;font-size:.65rem;font-family:monospace">${escapeHtml(a.action || "ACTION")}</span>
            <strong>${escapeHtml(a.target || "—")}</strong> — ${escapeHtml(a.detail || "")}
          </span>
        </label>
        <input class="input orch-action-input" data-idx="${i}" placeholder="${escapeHtml(
          a.requires_value || /clarif/i.test(String(a.detail || "")) || a.action === "ASK_HUMAN"
            ? "Type clarification or value (required — checkbox alone is not enough)"
            : "Provide value (URL, credentials, ticket ID…) — optional if handled externally"
        )}" value="${escapeHtml(a.provided_value || "")}" style="margin-top:.4rem" />
      </div>`).join("")
      : "";

    // Track whether the analyst asked for API / webpage access as a prerequisite item.
    prereqShowsApi = !!check.items?.some((it) => it.input_type === "api_curl");
    prereqShowsWeb = !!check.items?.some((it) => it.input_type === "webpage_url");

    const renderField = (item) => {
      const head = `
        <label class="field-label">${escapeHtml(item.label)}</label>
        <p class="prereq-hint">${escapeHtml(item.analyst_note || item.reason || item.hint)}</p>
        ${item.required_for?.length ? `<p class="prereq-for-ac">For ${escapeHtml(item.required_for.join(", "))}</p>` : ""}`;
      if (item.input_type === "api_curl") {
        return `<div class="prereq-field" data-id="${escapeHtml(item.id)}">${head}
        <textarea class="input curl-input prereq-curl-input" rows="4" placeholder="${escapeHtml(item.hint)}">${escapeHtml(humanApiInput.curl || "")}</textarea>
        <div class="prereq-curl-status" style="font-size:.72rem;margin-top:.3rem;color:var(--text-secondary)"></div>
      </div>`;
      }
      if (item.input_type === "webpage_url") {
        return `<div class="prereq-field" data-id="${escapeHtml(item.id)}">${head}
        <input class="input prereq-web-input" type="url" placeholder="${escapeHtml(item.hint)}" value="${escapeHtml(humanWebpageInput.url || "")}" />
      </div>`;
      }
      return `<div class="prereq-field" data-id="${escapeHtml(item.id)}">${head}
        <input class="input prereq-input" data-id="${escapeHtml(item.id)}" placeholder="${escapeHtml(item.hint)}" value="${escapeHtml(userPrerequisites[item.id]?.value || "")}" />
      </div>`;
    };

    const fieldList = check.items?.length
      ? `<div class="prereq-section-title">${actions.length ? "Additional fields" : "Only you can provide"}</div>`
        + check.items.map(renderField).join("")
      : "";

    if (!actionChecklist && !fieldList) {
      list.innerHTML = `<p style="font-size:.75rem;color:var(--text-secondary);margin:0">Nothing extra needed — the ticket already has what tests require.</p>`;
    } else {
      list.innerHTML = actionChecklist + fieldList;
    }

    list.querySelectorAll(".prereq-input").forEach((input) => {
      input.addEventListener("input", () => {
        const id = input.dataset.id;
        const meta = check.items.find((i) => i.id === id);
        userPrerequisites[id] = { value: input.value, label: meta?.label || id };
        updatePrerequisiteStatus();
      });
    });

    list.querySelectorAll(".orch-action-check").forEach((box) => {
      box.addEventListener("change", () => {
        const i = Number(box.dataset.idx);
        if (blockingOrchestratorActions[i]) {
          blockingOrchestratorActions[i].resolved = box.checked;
        }
        updatePrerequisiteStatus();
      });
    });

    list.querySelectorAll(".orch-action-input").forEach((input) => {
      input.addEventListener("input", () => {
        const i = Number(input.dataset.idx);
        const a = blockingOrchestratorActions[i];
        if (!a) return;
        a.provided_value = input.value;
        const hasValue = input.value.trim().length > 0;
        // Providing a value auto-resolves the action; clearing it reverts to the checkbox state.
        if (hasValue) {
          a.resolved = true;
          const box = list.querySelector(`.orch-action-check[data-idx="${i}"]`);
          if (box) box.checked = true;
        }
        userPrerequisites[`action-${i}`] = {
          value: input.value,
          label: a.detail || a.target || `Orchestrator action ${i + 1}`,
          action: a.action || "ACTION",
        };
        updatePrerequisiteStatus();
      });
    });

    const curlInput = list.querySelector(".prereq-curl-input");
    if (curlInput) {
      const statusNode = list.querySelector(".prereq-curl-status");
      curlInput.addEventListener("input", () => {
        const parsed = parseCurl(curlInput.value);
        humanApiInput = parsed.ok ? parsed : { ok: false, curl: curlInput.value };
        if (statusNode) {
          statusNode.textContent = curlInput.value.trim()
            ? (parsed.ok ? `Parsed: ${parsed.method} ${parsed.endpoint}` : parsed.error)
            : "";
          statusNode.style.color = parsed.ok ? "var(--accent, #16a34a)" : "var(--text-secondary)";
        }
        updatePrerequisiteStatus();
      });
    }

    const webInput = list.querySelector(".prereq-web-input");
    if (webInput) {
      webInput.addEventListener("input", () => {
        const parsed = parseWebpageInput(webInput.value, humanWebpageInput.title);
        humanWebpageInput = parsed.ok ? parsed : { ok: false, url: webInput.value, path: "", origin: "", title: "" };
        updatePrerequisiteStatus();
      });
    }
  }
  updatePrerequisiteStatus();
}


function updateReportHeaderButtons() {
  const ready = agentStatuses.reporter === "done" && !!getReportData();
  const viewBtn = el("btn-view-report");
  const dlBtn = el("btn-download-report");
  if (viewBtn) viewBtn.disabled = !ready;
  if (dlBtn) dlBtn.disabled = !ready;
}


function updateStats(i) {
  const row = el("stats-row");
  if (!row) return;
  if (idx < 0) { row.hidden = true; return; }
  row.hidden = false;
  const doneCount = AGENT_ROLES.filter(r => agentStatuses[r] === "done").length;
  el("stat-steps").textContent = (i + 1) + "/" + EVENTS.length;
  el("stat-agents").textContent = doneCount + "/6";
  const validations = EVENTS.slice(0, i + 1).filter(e => e.kind === "validator_return").length;
  const valEl = el("stat-validations");
  if (valEl) valEl.textContent = validations;
  el("stat-ac").textContent = currentStory?.acceptance_criteria ?? currentStory?.acceptance_criteria_list?.length ?? "—";
  el("stat-score").textContent = agentOutputs.reviewer?.score || currentStory?.score || "—";
}


function viewReport() {
  if (!getReportData()) {
    alert("Report is not ready yet. Run the pipeline until the Reporter step completes.");
    return;
  }
  activeOutputTab = "reporter";
  renderOutputTabs();
  renderActiveOutputTab();
  el("output-body")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
