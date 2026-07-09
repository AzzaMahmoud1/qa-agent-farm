#!/usr/bin/env python3
"""Split extracted inline script into agent/lib modules."""
import re
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTRACTED = ROOT / "scripts" / "_extracted-inline.js"

MODULE_MAP = {
    "registry": {
        "vars": [
            "FALLBACK_STORIES", "AGENT_ROLES", "PIPELINE_STEPS", "AGENT_META",
            "AGENT_GUIDELINES", "VALIDATOR_MAX_ATTEMPTS", "ORCHESTRATOR_INACTIVITY_TIMEOUT_MS",
            "VALIDATOR_GUIDELINES", "OUTPUT_ROLES",
        ],
        "funcs": [],
        "header": "/** Agent registry — roles, pipeline steps, guidelines, constants */\n",
    },
    "analyst": {
        "funcs": [
            "storyForPrerequisiteDetection", "buildAnalystOutputPayload", "buildAnalystPrerequisitePayload",
        ],
    },
    "writer": {
        "funcs": ["tcType", "buildWriterTestCases"],
    },
    "data-extractor": {
        "funcs": [
            "blockedDataExtractorOutput", "buildRequirementsFromStory", "getLiveRequirements",
            "extractTestOracle", "buildTestDataRow", "buildTestDataExtractorOutput",
        ],
    },
    "executor": {
        "funcs": ["blockedExecutorOutput", "buildTestExecutorOutput"],
    },
    "reviewer": {
        "funcs": ["buildReviewerOutput"],
    },
    "reporter": {
        "funcs": ["buildReporterOutput"],
    },
    "validator": {
        "funcs": [
            "buildValidationResult", "validateAnalystOutputLive", "validateRequirementAlignment",
            "outputHasApiFields", "validateRequirementsFreshness", "validateWriterCoverage",
            "validateGeoFieldsInBlob", "validateTestDataExtractorOutput", "resolveLiveValidatorReturn",
            "findDataExtractorGateSlice", "rebuildDataExtractorValidationGate", "buildValidatorLiveState",
        ],
        "vars": ["DATA_EXTRACTOR_API_CHECKS"],
    },
    "orchestrator": {
        "funcs": [
            "mem", "abortRunEvents", "validationGateEvents", "buildRequirementsFailureDemo",
            "resolvePipelineEvents", "buildPrerequisiteInputEvents", "buildHumanInputEvents",
            "enrichEventForDisplay", "buildEvents", "buildOrchestratorInactivityFailureEvents",
            "buildFeedbackLoops", "buildOrchestratorLiveState",
        ],
    },
    "pipeline": {
        "funcs": ["buildAgentOutputs"],
    },
    "lib/geo": {
        "funcs": [
            "isLatitudeKey", "isLongitudeKey", "parseCoordNumber", "isValidLatitude",
            "isValidLongitude", "isBoundaryLatitude", "isBoundaryLongitude",
        ],
    },
    "lib/test-data": {
        "funcs": [
            "inferApiFields", "buildInvalidFieldValue", "buildBoundaryFieldValue",
            "buildValidFieldValue", "inferRequirementSignals", "scenarioRoleForType",
        ],
    },
    "lib/human-input": {
        "funcs": [
            "acTextNeedsApi", "acTextNeedsWeb", "inferHumanInputNeeds", "normalizeCurlInput",
            "parseCurl", "formatCurlPreview", "parseWebpageInput", "humanInputTypeLabel",
            "orchestratorAwaitingLabel", "waitingForHumanInputDescription", "describeHumanInputNeed",
        ],
    },
    "lib/story": {
        "funcs": [
            "isRequirementsMetadataLine", "isLikelyAcceptanceCriterionLine", "sanitizeStoryAcceptanceCriteria",
            "parseAcceptanceCriteriaText", "parseRequirementsDescription", "parseStoryContent", "issueToStory",
        ],
    },
}

# UI / ctx-bound — stays in simulator-app
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
    "kindLabel", "kindClass", "setActive", "renderDict", "showEvent", "next", "prev",
    "reset", "stopPlay", "startPlay", "updateDemoBanner", "loadStory", "showEmptyTicketState",
    "loadStoryByKey", "startPipelineFromActiveSource", "startRequirementsDemo", "startDefaultPipeline",
}


def parse_functions(source):
    """Return dict name -> (start_line, end_line, body) 0-indexed lines."""
    lines = source.splitlines()
    func_starts = []
    for i, line in enumerate(lines):
        m = re.match(r"\s*(async\s+)?function\s+(\w+)\s*\(", line)
        if m:
            func_starts.append((i, m.group(2), bool(m.group(1))))
    func_starts.append((len(lines), None, False))

    funcs = {}
    for idx in range(len(func_starts) - 1):
        start, name, _ = func_starts[idx]
        end = func_starts[idx + 1][0]
        body = "\n".join(lines[start:end])
        funcs[name] = body
    return funcs, lines


def parse_top_level_vars(lines, var_names):
    """Extract const/let blocks for named vars from start of script."""
    source = "\n".join(lines)
    result = {}
    for name in var_names:
        # match const NAME = ... until next top-level const/let/function at 4 spaces
        pat = rf"^    const {re.escape(name)}\s*="
        m = re.search(pat, source, re.MULTILINE)
        if not m:
            continue
        start = m.start()
        # find end: next line starting with '    const ' or '    let ' or '    function '
        rest = source[m.end():]
        end_m = re.search(r"\n    (?:const |let |function |async function )", rest)
        block = source[start:m.end() + (end_m.start() if end_m else len(rest))]
        result[name] = block.strip()
    return result


def main():
    source = EXTRACTED.read_text()
    funcs, lines = parse_functions(source)

    assigned = set()
    for mod, spec in MODULE_MAP.items():
        for fn in spec.get("funcs", []):
            assigned.add(fn)
    assigned |= UI_FUNCS

    unassigned = set(funcs.keys()) - assigned
    if unassigned:
        print("UNASSIGNED:", sorted(unassigned))

    missing = []
    for mod, spec in MODULE_MAP.items():
        for fn in spec.get("funcs", []):
            if fn not in funcs:
                missing.append(f"{mod}:{fn}")
    if missing:
        print("MISSING from extract:", missing)

    # Write registry
    reg = MODULE_MAP["registry"]
    vars_block = parse_top_level_vars(lines, reg["vars"])
    reg_body = reg["header"]
    reg_body += "\n\n".join(vars_block[v] for v in reg["vars"] if v in vars_block)
    reg_body += "\n\nexport {\n  " + ",\n  ".join(reg["vars"]) + ",\n};\n"
    (ROOT / "agents" / "registry.js").write_text(reg_body)

    # Helper to write a module file
    def write_module(rel_path, func_names, extra_vars=None, imports="", exports_extra=None):
        parts = [imports.strip(), ""]
        if extra_vars:
            for v in extra_vars:
                if v in funcs:
                    pass
        for fn in func_names:
            if fn in funcs:
                # convert function to export function
                body = funcs[fn]
                body = re.sub(r"^    function ", "export function ", body)
                body = re.sub(r"^    async function ", "export async function ", body)
                parts.append(body)
                parts.append("")
        exp = list(func_names) + (exports_extra or [])
        exp = [e for e in exp if e in funcs or e in (extra_vars or [])]
        out = "\n".join(parts).rstrip() + "\n"
        path = ROOT / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(out)

    write_module("agents/analyst.js", MODULE_MAP["analyst"]["funcs"])
    write_module("agents/writer.js", MODULE_MAP["writer"]["funcs"])
    write_module("lib/geo.js", MODULE_MAP["lib/geo"]["funcs"])
    write_module("lib/test-data.js", MODULE_MAP["lib/test-data"]["funcs"],
                   imports='import { isLatitudeKey, isLongitudeKey, parseCoordNumber } from "./geo.js";\n')
    write_module("lib/human-input.js", MODULE_MAP["lib/human-input"]["funcs"])
    write_module("lib/story.js", MODULE_MAP["lib/story"]["funcs"])
    write_module("agents/data-extractor.js", MODULE_MAP["data-extractor"]["funcs"])
    write_module("agents/executor.js", MODULE_MAP["executor"]["funcs"])
    write_module("agents/reviewer.js", MODULE_MAP["reviewer"]["funcs"])
    write_module("agents/reporter.js", MODULE_MAP["reporter"]["funcs"])
    write_module("agents/validator.js", MODULE_MAP["validator"]["funcs"])
    write_module("agents/orchestrator.js", MODULE_MAP["orchestrator"]["funcs"])
    write_module("agents/pipeline.js", MODULE_MAP["pipeline"]["funcs"])

    # UI remainder
    ui_parts = []
    # top-level lets from original (state vars)
    for i, line in enumerate(lines):
        if re.match(r"^    let ", line):
            ui_parts.append(line[4:])  # dedent one level
        elif re.match(r"^    const buildHumanApiEvents", line):
            ui_parts.append(line[4:])
            break
    ui_parts.append("")
    for fn in sorted(UI_FUNCS):
        if fn in funcs:
            body = funcs[fn]
            ui_parts.append(body[4:] if body.startswith("    ") else body)
            ui_parts.append("")

    # init IIFE and event handlers at end
    in_init = False
    for line in lines:
        if line.strip().startswith("el(\"btn-next\")"):
            in_init = True
        if in_init:
            ui_parts.append(line[4:] if line.startswith("    ") else line)

    (ROOT / "scripts" / "_ui-remainder.js").write_text("\n".join(ui_parts))
    print("Wrote modules + _ui-remainder.js")


if __name__ == "__main__":
    main()
