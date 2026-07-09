#!/usr/bin/env python3
"""Post-process split modules: dedent, add imports, wire ctx bridge."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CTX_GLOBALS = [
    "humanApiInput", "humanWebpageInput", "storyOutputs", "currentStory",
    "userPrerequisites", "cachedPrerequisiteCheck", "cachedHumanInputNeed",
    "EVENTS", "idx", "playing", "pausedForHumanInput", "agentOutputs", "agentStatuses",
    "activeOutputTab", "currentRunOptions", "agentChangeLog", "currentInputSource",
    "jiraConfigured", "orchestratorInactivityTimer", "orchestratorInactivityCountdownInterval",
    "orchestratorInactivityDeadline",
]

PREREQ_GLOBALS = [
    "buildAnalystOutput", "analyzeStoryPrerequisites", "detectTicketPrerequisites",
    "validateAnalystOutput", "parseFullRequirements", "sanitizeAcceptanceCriteria",
    "isLikelyAcceptanceCriterion", "isMetadataLine",
]

REGISTRY_GLOBALS = [
    "FALLBACK_STORIES", "AGENT_ROLES", "PIPELINE_STEPS", "AGENT_META", "AGENT_GUIDELINES",
    "VALIDATOR_MAX_ATTEMPTS", "ORCHESTRATOR_INACTIVITY_TIMEOUT_MS", "VALIDATOR_GUIDELINES",
    "OUTPUT_ROLES", "DATA_EXTRACTOR_API_CHECKS",
]

CTX_FUNCS = [
    "getProvidedPrerequisites", "isPrerequisitesSatisfied", "getPrerequisiteCheck",
    "getLiveHumanInputNeed", "isHumanInputSatisfied", "storyRequiresApi", "storyRequiresWebpage",
    "isRequiredInputReady", "el",
]

AGENT_CROSS_REFS = {
    "analyst": ["storyForPrerequisiteDetection", "buildAnalystOutputPayload", "buildAnalystPrerequisitePayload"],
    "writer": ["tcType", "buildWriterTestCases"],
    "data-extractor": [
        "blockedDataExtractorOutput", "buildRequirementsFromStory", "getLiveRequirements",
        "extractTestOracle", "buildTestDataRow", "buildTestDataExtractorOutput",
    ],
    "executor": ["blockedExecutorOutput", "buildTestExecutorOutput"],
    "reviewer": ["buildReviewerOutput"],
    "reporter": ["buildReporterOutput"],
    "validator": [
        "buildValidationResult", "validateAnalystOutputLive", "validateRequirementAlignment",
        "outputHasApiFields", "validateRequirementsFreshness", "validateWriterCoverage",
        "validateGeoFieldsInBlob", "validateTestDataExtractorOutput", "resolveLiveValidatorReturn",
        "buildValidatorLiveState",
    ],
    "orchestrator": [
        "mem", "abortRunEvents", "validationGateEvents", "buildRequirementsFailureDemo",
        "resolvePipelineEvents", "buildPrerequisiteInputEvents", "buildHumanInputEvents",
        "enrichEventForDisplay", "buildEvents", "buildOrchestratorInactivityFailureEvents",
        "buildFeedbackLoops", "buildOrchestratorLiveState",
    ],
    "pipeline": ["buildAgentOutputs"],
}

LIB_IMPORTS = {
    "lib/geo.js": [],
    "lib/test-data.js": ["isLatitudeKey", "isLongitudeKey", "parseCoordNumber"],
    "lib/human-input.js": [],
    "lib/story.js": [],
}


def dedent(text, spaces=4):
    lines = text.splitlines()
    out = []
    for line in lines:
        if line.startswith(" " * spaces):
            out.append(line[spaces:])
        else:
            out.append(line)
    return "\n".join(out).rstrip() + "\n"


def bridge_replace(text):
    """Replace bare globals with farmCtx references (word boundaries)."""
    for name in CTX_GLOBALS + CTX_FUNCS:
        text = re.sub(rf"\b{re.escape(name)}\b", f"farmCtx.{name}", text)
    for name in PREREQ_GLOBALS:
        text = re.sub(rf"\b{re.escape(name)}\b", f"farmCtx.prerequisites.{name}", text)
    # Don't bridge farmCtx.farmCtx
    text = text.replace("farmCtx.farmCtx", "farmCtx")
    return text


def process_file(path, extra_imports="", skip_bridge=False):
    text = path.read_text()
    text = dedent(text)
    if not skip_bridge and "farmCtx" not in text[:200]:
        text = bridge_replace(text)
    if extra_imports:
        text = extra_imports.strip() + "\n\n" + text
    path.write_text(text)


def write_writer_reviewer_reporter():
    writer = '''import { tcType } from "./writer.js";
// buildWriterTestCases extracted from buildAgentOutputs
export function buildWriterTestCases(story) {
  const s = story.id;
  const acList = story.acceptance_criteria_list || [];
  const tcIds = story.test_cases;
  return tcIds.map((id, i) => {
    const ac = acList[i] || acList[0] || story.title;
    const type = tcType(i, tcIds.length);
    return {
      id,
      title: ac.length > 80 ? ac.slice(0, 77) + "…" : ac,
      type,
      given: story.from_requirements
        ? `Requirements ${s} loaded from pasted description`
        : `Ticket ${s} is loaded with JIRA context`,
      when: `Scenario exercises AC #${i + 1}: ${ac.slice(0, 60)}${ac.length > 60 ? "…" : ""}`,
      then: type === "happy_path" ? "Expected behavior passes per AC" : "System rejects or handles edge correctly",
      expected_evidence: type === "happy_path" ? "HTTP 200 / success response" : "HTTP 4xx with clear error",
      suggested_file: `tests/api/${s.toLowerCase()}.spec.ts`,
    };
  });
}
'''
    reviewer = '''export function buildReviewerOutput(story, tcIds) {
  return {
    score: story.score,
    what_is_good: `Covers ${tcIds.length} scenarios mapped to JIRA acceptance criteria with API evidence.`,
    root_cause_risk: story.priority === "High" ? "High regression risk if fix is incomplete" : "Moderate — verify AC parity across versions",
    impact: `${story.priority} priority · Status: ${story.status}`,
    missing_coverage: ["Load/performance under filter combinations", "Concurrent request handling"],
    codebase_conflicts: [],
    duplicate_coverage: [],
    fix: "Add regression tests per AC and validate against staging before close.",
  };
}
'''
    reporter = '''export function buildReporterOutput(story, test_cases) {
  const s = story.id;
  const tcIds = story.test_cases;
  return {
    project_name: "SEHA",
    ticket_key: s,
    ticket_title: story.title,
    report_date: new Date().toLocaleDateString("en-US"),
    environment: story.from_jira ? "JIRA live + simulator" : "Simulator mock",
    summary: { planned: tcIds.length, executed: 0, passed: 0, failed: 0, blocked: 0 },
    regression_rows: test_cases.map((tc) => ({
      id: tc.id,
      title: tc.title,
      type: tc.type.replace("_", " "),
      status: "Planned",
    })),
    defects: { reported: 0, fixed: 0, opened: 0, low: 0, medium: 0, high: 0 },
    comments: `Generated from ${story.from_jira ? "live JIRA ticket" : "mock data"}. Run against staging to mark executed.`,
    reported_by: "QA Agent Farm",
  };
}
'''
    (ROOT / "agents/writer.js").write_text(
        dedent((ROOT / "agents/writer.js").read_text().split("export function tcType")[0] + "export function tcType" +
               (ROOT / "agents/writer.js").read_text().split("export function tcType")[1].split("export function")[0] if "tcType" in (ROOT / "agents/writer.js").read_text() else "")
    )
    # rewrite writer with tcType + buildWriterTestCases
    tc_part = (ROOT / "agents/writer.js").read_text()
    if "buildWriterTestCases" not in tc_part:
        (ROOT / "agents/writer.js").write_text(dedent((ROOT / "agents/writer.js").read_text()) + "\n" + dedent(writer.split("import")[1]))
    (ROOT / "agents/reviewer.js").write_text(reviewer)
    (ROOT / "agents/reporter.js").write_text(reporter)


def main():
    # ctx bridge
    (ROOT / "agents/ctx-bridge.js").write_text(
        '/** Mutable runtime context set by createAgentFarm(ctx) */\nexport let farmCtx = null;\n'
        'export function setFarmCtx(ctx) { farmCtx = ctx; }\n'
    )

    write_writer_reviewer_reporter()

    # registry - no bridge
    process_file(ROOT / "agents/registry.js", skip_bridge=True)

    lib_import_lines = {
        ROOT / "lib/test-data.js": 'import { isLatitudeKey, isLongitudeKey, parseCoordNumber } from "./geo.js";\n',
        ROOT / "lib/human-input.js": 'import { buildRequirementsFromStory } from "../agents/data-extractor.js";\n',
    }

    for path in (ROOT / "agents").glob("*.js"):
        if path.name in ("registry.js", "ctx-bridge.js", "index.js"):
            continue
        extra = 'import { farmCtx } from "./ctx-bridge.js";\n'
        if path.name == "pipeline.js":
            extra += '''import {
  AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_GUIDELINES, VALIDATOR_MAX_ATTEMPTS,
} from "./registry.js";
import { buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
import { buildWriterTestCases } from "./writer.js";
import { buildReviewerOutput } from "./reviewer.js";
import { buildReporterOutput } from "./reporter.js";
import { buildTestDataExtractorOutput } from "./data-extractor.js";
import { buildTestExecutorOutput } from "./executor.js";
'''
        process_file(path, extra_imports=extra)

    for path in (ROOT / "lib").glob("*.js"):
        if path.name == "prerequisites.js":
            continue
        extra = lib_import_lines.get(path, "")
        process_file(path, extra_imports=extra, skip_bridge=True)

    print("post-process done")


if __name__ == "__main__":
    main()
