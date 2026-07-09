#!/usr/bin/env python3
"""Build final agent framework modules from extracted inline script."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "_extracted-inline.js"

CTX = [
    "humanApiInput", "humanWebpageInput", "storyOutputs", "currentStory",
    "userPrerequisites", "cachedPrerequisiteCheck", "cachedHumanInputNeed",
    "EVENTS", "idx", "playing", "pausedForHumanInput", "agentOutputs",
    "agentStatuses", "activeOutputTab", "currentRunOptions", "agentChangeLog",
    "currentInputSource", "jiraConfigured", "orchestratorInactivityTimer",
    "orchestratorInactivityCountdownInterval", "orchestratorInactivityDeadline",
    "getProvidedPrerequisites", "isPrerequisitesSatisfied", "getPrerequisiteCheck",
    "getLiveHumanInputNeed", "isHumanInputSatisfied", "storyRequiresApi",
    "storyRequiresWebpage", "isRequiredInputReady", "el",
]
PREREQ = [
    "buildAnalystOutput", "analyzeStoryPrerequisites", "detectTicketPrerequisites",
    "validateAnalystOutput", "parseFullRequirements", "sanitizeAcceptanceCriteria",
    "isLikelyAcceptanceCriterion", "isMetadataLine",
]

UI_FUNCS = {
    "getPrerequisiteCheck", "isPrerequisitesSatisfied", "getProvidedPrerequisites",
    "isWaitingForPrerequisites", "updatePrerequisiteStatus", "updatePrerequisitesPanel",
    "promptForPrerequisites", "submitPrerequisites", "isRequiredInputReady",
    "promptForRequiredInput", "isExecutionPhaseBlocked", "getLiveHumanInputNeed",
    "isHumanInputSatisfied", "storyRequiresApi", "storyRequiresWebpage",
    "resumeOrchestratorAfterHumanInput", "isBlockingOrchestratorWait", "isWaitingForHumanInput",
    "formatCountdown", "updateOrchestratorInactivityCountdownUI", "clearOrchestratorInactivityTimer",
    "handleOrchestratorInactivityTimeout", "startOrchestratorInactivityTimer",
    "renderCurlPreview", "getHumanApiInput", "setHumanInputStatus", "renderWebPreview",
    "updateHumanInputPanel", "renderPipelineBar", "updateStats", "getDoneRolesUpTo",
    "parseIssueKey", "buildStoryFromRequirementsForm", "fillRequirementsForm",
    "setRequirementsLoadStatus", "setInputSource", "loadRequirementsFromForm", "loadSampleRequirements",
    "sanitizeLogFilename", "logTimestamp", "formatLogObject", "buildRunLogExport",
    "triggerFileDownload", "downloadRunLog", "updateReportHeaderButtons", "viewReport",
    "downloadReport", "focusReportTabIfReady", "getReportData", "renderReportView",
    "getJiraInput", "browseUrlForKey", "resolveTicketInput", "renderTicketPanel",
    "escapeHtml", "setJiraStatus", "apiFetch", "checkJiraHealth", "fetchJiraTicket",
    "syncOrchestratorOutput", "initAgentOutputState", "setAgentOutputStatus",
    "renderOutputTabs", "renderKv", "renderTestCases", "renderTestDataOutput",
    "renderTestExecutorOutput", "renderApiOutput", "renderOrchestratorOutput",
    "renderFeedbackLoopsHtml", "renderAnalystOutput", "renderValidatorOutput",
    "renderReviewerOutput", "renderActiveOutputTab", "syncOutputsToIndex",
    "renderEventFeedbackClarification", "findHumanInputEventSlice", "rebuildHumanInputEventSlice",
    "syncRequirementsToTestData", "syncHumanInputToOutputs", "submitHumanInput",
    "findDataExtractorGateSlice", "rebuildDataExtractorValidationGate",
    "kindLabel", "kindClass", "setActive", "renderDict", "showEvent", "next", "prev",
    "reset", "stopPlay", "startPlay", "updateDemoBanner", "loadStory", "showEmptyTicketState",
    "loadStoryByKey", "startPipelineFromActiveSource", "startRequirementsDemo", "startDefaultPipeline",
    "renderAgentChangesBlock", "renderAnalystPrerequisitesBlock", "renderAnalystScratchpad",
    "renderStructuredAnalystOutput", "syncValidatorOutput", "unlockAgentOutput",
}

MODULE_FUNCS = {
    "agents/analyst.js": ["storyForPrerequisiteDetection", "buildAnalystOutputPayload", "buildAnalystPrerequisitePayload"],
    "lib/geo.js": ["isLatitudeKey", "isLongitudeKey", "parseCoordNumber", "isValidLatitude", "isValidLongitude", "isBoundaryLatitude", "isBoundaryLongitude"],
    "lib/test-data.js": ["inferApiFields", "buildInvalidFieldValue", "buildBoundaryFieldValue", "buildValidFieldValue", "inferRequirementSignals", "scenarioRoleForType"],
    "lib/human-input.js": ["acTextNeedsApi", "acTextNeedsWeb", "inferHumanInputNeeds", "normalizeCurlInput", "parseCurl", "formatCurlPreview", "parseWebpageInput", "humanInputTypeLabel", "orchestratorAwaitingLabel", "waitingForHumanInputDescription", "describeHumanInputNeed"],
    "lib/story.js": ["isRequirementsMetadataLine", "isLikelyAcceptanceCriterionLine", "sanitizeStoryAcceptanceCriteria", "parseAcceptanceCriteriaText", "parseRequirementsDescription", "parseStoryContent", "issueToStory"],
    "lib/requirements.js": ["buildRequirementsFromStory", "getLiveRequirements"],
    "agents/data-extractor.js": ["blockedDataExtractorOutput", "extractTestOracle", "buildTestDataRow", "buildTestDataExtractorOutput"],
    "agents/executor.js": ["blockedExecutorOutput", "buildTestExecutorOutput"],
    "agents/validator.js": ["buildValidationResult", "validateAnalystOutputLive", "validateRequirementAlignment", "outputHasApiFields", "validateRequirementsFreshness", "validateWriterCoverage", "validateGeoFieldsInBlob", "validateTestDataExtractorOutput", "resolveLiveValidatorReturn", "buildValidatorLiveState"],
    "agents/orchestrator.js": ["mem", "abortRunEvents", "validationGateEvents", "buildRequirementsFailureDemo", "resolvePipelineEvents", "buildPrerequisiteInputEvents", "buildHumanInputEvents", "enrichEventForDisplay", "buildEvents", "buildOrchestratorInactivityFailureEvents", "buildFeedbackLoops", "buildOrchestratorLiveState"],
}

HEADERS = {
    "agents/analyst.js": 'import { farmCtx } from "./ctx-bridge.js";\n',
    "lib/requirements.js": 'import { farmCtx } from "../agents/ctx-bridge.js";\n',
    "lib/story.js": 'import { farmCtx } from "../agents/ctx-bridge.js";\n',
    "lib/test-data.js": 'import { isLatitudeKey, isLongitudeKey, parseCoordNumber } from "./geo.js";\n',
    "lib/human-input.js": 'import { buildRequirementsFromStory } from "./requirements.js";\n',
    "agents/data-extractor.js": '''import { farmCtx } from "./ctx-bridge.js";
import { buildRequirementsFromStory } from "../lib/requirements.js";
import { inferHumanInputNeeds } from "../lib/human-input.js";
import { inferRequirementSignals, scenarioRoleForType, inferApiFields, buildInvalidFieldValue, buildBoundaryFieldValue, buildValidFieldValue } from "../lib/test-data.js";
import { buildAnalystPrerequisitePayload } from "./analyst.js";
''',
    "agents/executor.js": '''import { farmCtx } from "./ctx-bridge.js";
''',
    "agents/validator.js": '''import { farmCtx } from "./ctx-bridge.js";
import { AGENT_GUIDELINES, AGENT_META, VALIDATOR_MAX_ATTEMPTS } from "./registry.js";
import { buildRequirementsFromStory } from "../lib/requirements.js";
import { inferRequirementSignals, inferApiFields } from "../lib/test-data.js";
import { isLatitudeKey, isLongitudeKey, parseCoordNumber, isValidLatitude, isValidLongitude, isBoundaryLatitude, isBoundaryLongitude } from "../lib/geo.js";
''',
    "agents/orchestrator.js": '''import { farmCtx } from "./ctx-bridge.js";
import { AGENT_META, AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_MAX_ATTEMPTS, ORCHESTRATOR_INACTIVITY_TIMEOUT_MS, VALIDATOR_GUIDELINES } from "./registry.js";
import { buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
import { tcType } from "./writer.js";
import { inferHumanInputNeeds } from "../lib/human-input.js";
import { buildValidationResult, validateAnalystOutputLive } from "./validator.js";
''',
}


def parse_functions(source):
    lines = source.splitlines()
    starts = []
    for i, line in enumerate(lines):
        m = re.match(r"\s*(async\s+)?function\s+(\w+)\s*\(", line)
        if m:
            starts.append((i, m.group(2)))
    starts.append((len(lines), None))
    funcs = {}
    for j in range(len(starts) - 1):
        i, name = starts[j]
        end = starts[j + 1][0]
        funcs[name] = "\n".join(lines[i:end])
    return funcs, lines


def dedent_fn(body):
    lines = body.splitlines()
    out = []
    for line in lines:
        if line.startswith("    "):
            out.append(line[4:])
        else:
            out.append(line)
    text = "\n".join(out)
    text = re.sub(r"^function ", "export function ", text, count=1)
    text = re.sub(r"^async function ", "export async function ", text, count=1)
    return text


def bridge(text, use_ctx=True):
    if not use_ctx:
        return text
    for n in sorted(CTX, key=len, reverse=True):
        text = re.sub(rf"(?<![.\w]){re.escape(n)}(?![.\w])", f"farmCtx.{n}", text)
    for n in sorted(PREREQ, key=len, reverse=True):
        text = re.sub(rf"(?<![.\w]){re.escape(n)}(?![.\w])", f"farmCtx.prerequisites.{n}", text)
    return text.replace("farmCtx.farmCtx", "farmCtx")


def extract_registry_vars(lines):
    names = ["FALLBACK_STORIES", "AGENT_ROLES", "PIPELINE_STEPS", "AGENT_META", "AGENT_GUIDELINES",
             "VALIDATOR_MAX_ATTEMPTS", "ORCHESTRATOR_INACTIVITY_TIMEOUT_MS", "VALIDATOR_GUIDELINES", "OUTPUT_ROLES"]
    src = "\n".join(lines)
    blocks = []
    for name in names:
        m = re.search(rf"^    const {name}\s*=[\s\S]*?(?=\n    const |\n    let |\n    function )", src, re.M)
        if m:
            blocks.append(m.group(0)[4:])
    export = "export {\n  " + ",\n  ".join(names) + ",\n};\n"
    return "/** Agent registry — roles, pipeline steps, guidelines, constants */\n" + "\n\n".join(blocks) + "\n\n" + export


def build_module(path, func_names, funcs, use_ctx=True):
    header = HEADERS.get(path, "")
    parts = [header]
    if path == "agents/validator.js":
        parts.append('''export const DATA_EXTRACTOR_API_CHECKS = [
  "For API stories: derive datasets from human-provided curl (URL, method, headers, body)",
  "Never use unrelated mock data (e.g. login emails) from other stories",
  "Map each dataset row to a writer test case ID and acceptance criterion",
  "Extract test_oracle per row from writer then/expected_evidence and AC text",
  "Datasets must satisfy current analyst testable conditions",
  "Fail if requirements changed since extraction — data must be re-synced",
  "Valid lat/lon within geographic range; invalid/boundary rows use correct edge values",
  "Extract test data for every writer test case",
];

''')
    for fn in func_names:
        if fn not in funcs:
            print("WARN missing", fn, "in", path)
            continue
        parts.append(bridge(dedent_fn(funcs[fn]), use_ctx))
        parts.append("")
    out = ROOT / path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(parts).rstrip() + "\n")


def build_index():
    text = '''import { setFarmCtx } from "./ctx-bridge.js";
import * as registry from "./registry.js";
import * as analyst from "./analyst.js";
import * as writer from "./writer.js";
import * as reviewer from "./reviewer.js";
import * as reporter from "./reporter.js";
import * as dataExtractor from "./data-extractor.js";
import * as executor from "./executor.js";
import * as validator from "./validator.js";
import * as orchestrator from "./orchestrator.js";
import { buildAgentOutputs } from "./pipeline.js";

/**
 * @param {object} ctx - runtime deps: mutable state, DOM helpers, prerequisites module
 */
export function createAgentFarm(ctx) {
  setFarmCtx(ctx);
  return {
    ...registry,
    ...analyst,
    ...writer,
    ...reviewer,
    ...reporter,
    ...dataExtractor,
    ...executor,
    ...validator,
    ...orchestrator,
    buildAgentOutputs,
  };
}

export * from "./registry.js";
'''
    (ROOT / "agents/index.js").write_text(text)


def build_simulator_app(funcs, lines):
    ui_parts = []
    # state lets
    for line in lines:
        if re.match(r"^    let ", line):
            ui_parts.append(line[4:])
        if line.strip().startswith("const buildHumanApiEvents"):
            ui_parts.append(line[4:])
            break
    ui_parts.append("")

    for fn in sorted(UI_FUNCS):
        if fn in funcs:
            body = funcs[fn]
            ui_parts.append(re.sub(r"^    ", "", body, flags=re.M))
            ui_parts.append("")

    # handlers + init from el("btn-next")
    capture = False
    for line in lines:
        if 'el("btn-next")' in line:
            capture = True
        if capture:
            ui_parts.append(line[4:] if line.startswith("    ") else line)

    header = '''import { createAgentFarm } from "../agents/index.js";
import {
  FALLBACK_STORIES, AGENT_ROLES, PIPELINE_STEPS, AGENT_META, AGENT_GUIDELINES,
  VALIDATOR_MAX_ATTEMPTS, ORCHESTRATOR_INACTIVITY_TIMEOUT_MS, VALIDATOR_GUIDELINES, OUTPUT_ROLES,
} from "../agents/registry.js";
import * as prerequisites from "../lib/prerequisites.js";

const el = (id) => document.getElementById(id);

// --- mutable runtime state (ctx) ---
'''
    footer = '''

// --- bootstrap ---
const ctx = {
  humanApiInput: { ok: false, curl: "", base_url: "", endpoint: "", method: "GET", url: "", headers: {}, auth: "", body: null },
  humanWebpageInput: { ok: false, url: "", path: "", origin: "", title: "" },
  prerequisites,
  el,
};
// attach mutable fields after declarations
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
  getProvidedPrerequisites,
  isPrerequisitesSatisfied,
  getPrerequisiteCheck,
  getLiveHumanInputNeed,
  isHumanInputSatisfied,
  storyRequiresApi,
  storyRequiresWebpage,
  isRequiredInputReady,
});

const farm = createAgentFarm(ctx);
const {
  buildAgentOutputs, buildEvents, resolvePipelineEvents, mem,
  buildAnalystOutputPayload, buildAnalystPrerequisitePayload,
  buildRequirementsFromStory, getLiveRequirements,
  inferHumanInputNeeds, validateAnalystOutputLive, validateTestDataExtractorOutput,
  resolveLiveValidatorReturn, validationGateEvents, buildOrchestratorInactivityFailureEvents,
  buildValidatorLiveState, buildFeedbackLoops, buildOrchestratorLiveState, enrichEventForDisplay,
  buildPrerequisiteInputEvents, buildHumanInputEvents,
} = farm;
'''
    (ROOT / "js/simulator-app.js").write_text(header + "\n".join(ui_parts) + footer)


def main():
    source = SRC.read_text()
    funcs, lines = parse_functions(source)
    (ROOT / "agents/registry.js").write_text(extract_registry_vars(lines))
    for path, names in MODULE_FUNCS.items():
        use_ctx = not path.startswith("lib/geo") and not path.startswith("lib/test-data") and path != "lib/human-input.js"
        if path == "lib/story.js":
            use_ctx = True
        if path == "lib/human-input.js":
            use_ctx = False
        build_module(path, names, funcs, use_ctx)
    build_index()
    build_simulator_app(funcs, lines)
    print("built framework")


if __name__ == "__main__":
    main()
