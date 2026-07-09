#!/usr/bin/env python3
"""Dedent agent/lib modules and wire farmCtx + imports."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CTX_NAMES = {
    "humanApiInput", "humanWebpageInput", "storyOutputs", "currentStory",
    "userPrerequisites", "cachedPrerequisiteCheck", "cachedHumanInputNeed",
    "EVENTS", "idx", "playing", "pausedForHumanInput", "agentOutputs",
    "agentStatuses", "activeOutputTab", "currentRunOptions", "agentChangeLog",
    "currentInputSource", "jiraConfigured", "orchestratorInactivityTimer",
    "orchestratorInactivityCountdownInterval", "orchestratorInactivityDeadline",
    "getProvidedPrerequisites", "isPrerequisitesSatisfied", "getPrerequisiteCheck",
    "getLiveHumanInputNeed", "isHumanInputSatisfied", "storyRequiresApi",
    "storyRequiresWebpage", "isRequiredInputReady", "el",
}

PREREQ_NAMES = {
    "buildAnalystOutput", "analyzeStoryPrerequisites", "detectTicketPrerequisites",
    "validateAnalystOutput", "parseFullRequirements", "sanitizeAcceptanceCriteria",
    "isLikelyAcceptanceCriterion", "isMetadataLine",
}

REGISTRY_NAMES = {
    "FALLBACK_STORIES", "AGENT_ROLES", "PIPELINE_STEPS", "AGENT_META", "AGENT_GUIDELINES",
    "VALIDATOR_MAX_ATTEMPTS", "ORCHESTRATOR_INACTIVITY_TIMEOUT_MS", "VALIDATOR_GUIDELINES",
    "OUTPUT_ROLES", "DATA_EXTRACTOR_API_CHECKS",
}

IMPORTS_BY_FILE = {
    "analyst.js": 'import { farmCtx } from "./ctx-bridge.js";\n',
    "writer.js": "",
    "reviewer.js": "",
    "reporter.js": "",
    "data-extractor.js": '''import { farmCtx } from "./ctx-bridge.js";
import { inferRequirementSignals, scenarioRoleForType, inferApiFields, buildInvalidFieldValue, buildBoundaryFieldValue, buildValidFieldValue } from "../lib/test-data.js";
import { inferHumanInputNeeds } from "../lib/human-input.js";
import { buildAnalystPrerequisitePayload } from "./analyst.js";
''',
    "executor.js": '''import { farmCtx } from "./ctx-bridge.js";
import { getPrerequisiteCheck } from "./analyst-helpers.js";
''',
    "validator.js": '''import { farmCtx } from "./ctx-bridge.js";
import {
  AGENT_GUIDELINES, AGENT_META, VALIDATOR_MAX_ATTEMPTS, DATA_EXTRACTOR_API_CHECKS,
} from "./registry.js";
import { buildRequirementsFromStory } from "./data-extractor.js";
import { inferRequirementSignals } from "../lib/test-data.js";
import { inferApiFields } from "../lib/test-data.js";
import {
  isLatitudeKey, isLongitudeKey, parseCoordNumber, isValidLatitude, isValidLongitude,
  isBoundaryLatitude, isBoundaryLongitude,
} from "../lib/geo.js";
import { validateAnalystOutputLive } from "./validator-analyst.js";
''',
    "orchestrator.js": '''import { farmCtx } from "./ctx-bridge.js";
import {
  AGENT_META, AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_MAX_ATTEMPTS,
  ORCHESTRATOR_INACTIVITY_TIMEOUT_MS, VALIDATOR_GUIDELINES,
} from "./registry.js";
import { buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
import { tcType } from "./writer.js";
import { inferHumanInputNeeds } from "../lib/human-input.js";
import { buildValidationResult, validateAnalystOutputLive } from "./validator.js";
import { buildPrerequisiteInputEvents as _buildPrereq } from "./orchestrator-events.js";
''',
    "pipeline.js": '''import { farmCtx } from "./ctx-bridge.js";
import {
  AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_GUIDELINES, VALIDATOR_MAX_ATTEMPTS,
} from "./registry.js";
import { buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
import { buildWriterTestCases } from "./writer.js";
import { buildReviewerOutput } from "./reviewer.js";
import { buildReporterOutput } from "./reporter.js";
import { buildTestDataExtractorOutput } from "./data-extractor.js";
import { buildTestExecutorOutput } from "./executor.js";
''',
    "geo.js": "",
    "test-data.js": 'import { isLatitudeKey, isLongitudeKey, parseCoordNumber } from "./geo.js";\n',
    "human-input.js": 'import { buildRequirementsFromStory } from "../agents/data-extractor.js";\n',
    "story.js": 'import { farmCtx } from "../agents/ctx-bridge.js";\n',
}


def dedent_block(text):
    lines = text.splitlines()
    return "\n".join(line[4:] if line.startswith("    ") else line for line in lines).strip() + "\n"


def bridge(text):
    for n in sorted(CTX_NAMES, key=len, reverse=True):
        text = re.sub(rf"(?<![.\w]){re.escape(n)}(?![.\w])", f"farmCtx.{n}", text)
    for n in sorted(PREREQ_NAMES, key=len, reverse=True):
        text = re.sub(rf"(?<![.\w]){re.escape(n)}(?![.\w])", f"farmCtx.prerequisites.{n}", text)
    for n in sorted(REGISTRY_NAMES, key=len, reverse=True):
        text = re.sub(rf"(?<![.\w]){re.escape(n)}(?![.\w])", n, text)  # registry imported
    text = text.replace("farmCtx.farmCtx", "farmCtx")
    return text


def process_agent_file(name):
    path = ROOT / "agents" / name
    if not path.exists() or name in ("index.js", "ctx-bridge.js", "writer.js", "reviewer.js", "reporter.js"):
        return
    body = dedent_block(path.read_text())
    if name != "registry.js":
        body = bridge(body)
    header = IMPORTS_BY_FILE.get(name, 'import { farmCtx } from "./ctx-bridge.js";\n')
    path.write_text((header + "\n" + body).strip() + "\n")


def process_lib_file(name):
    path = ROOT / "lib" / name
    if name == "prerequisites.js":
        return
    body = dedent_block(path.read_text())
    if name == "story.js":
        body = bridge(body)
    header = IMPORTS_BY_FILE.get(name, "")
    path.write_text((header + "\n" + body).strip() + "\n")


def fix_registry():
    text = (ROOT / "agents/registry.js").read_text()
    text = dedent_block(text)
  # fix export block indentation
    if "export {" not in text:
        names = list(REGISTRY_NAMES - {"DATA_EXTRACTOR_API_CHECKS"})
        text += "\nexport {\n  " + ",\n  ".join(sorted(names)) + ",\n};\n"
    (ROOT / "agents/registry.js").write_text(text)


def add_data_extractor_checks():
    vpath = ROOT / "agents/validator.js"
    if vpath.exists() and "DATA_EXTRACTOR_API_CHECKS" not in vpath.read_text()[:500]:
        checks = '''
export const DATA_EXTRACTOR_API_CHECKS = [
  "For API stories: derive datasets from human-provided curl (URL, method, headers, body)",
  "Never use unrelated mock data (e.g. login emails) from other stories",
  "Map each dataset row to a writer test case ID and acceptance criterion",
  "Extract test_oracle per row from writer then/expected_evidence and AC text",
  "Datasets must satisfy current analyst testable conditions",
  "Fail if requirements changed since extraction — data must be re-synced",
  "Valid lat/lon within geographic range; invalid/boundary rows use correct edge values",
  "Extract test data for every writer test case",
];
'''
        vpath.write_text(checks + "\n" + vpath.read_text())


def rewrite_pipeline():
    text = '''import { farmCtx } from "./ctx-bridge.js";
import {
  AGENT_ROLES, AGENT_GUIDELINES, VALIDATOR_GUIDELINES, VALIDATOR_MAX_ATTEMPTS,
} from "./registry.js";
import { buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
import { buildWriterTestCases } from "./writer.js";
import { buildReviewerOutput } from "./reviewer.js";
import { buildReporterOutput } from "./reporter.js";
import { buildTestDataExtractorOutput } from "./data-extractor.js";
import { buildTestExecutorOutput } from "./executor.js";

export function buildAgentOutputs(story) {
  const s = story.id;
  const tcIds = story.test_cases;
  const test_cases = buildWriterTestCases(story);

  const analystOutput = (() => {
    const full = buildAnalystOutputPayload(story);
    const prereqLegacy = buildAnalystPrerequisitePayload(story);
    return {
      success: full.success,
      scratchpad: full.scratchpad,
      analyst_reasoning: full.analyst_reasoning,
      testable_conditions: full.testable_conditions,
      prerequisites_needed: {
        ...prereqLegacy,
        blocking: full.prerequisites_needed?.blocking || [],
        non_blocking: full.prerequisites_needed?.non_blocking || [],
      },
      coverage_gaps: full.coverage_gaps,
      affected_components: full.affected_components,
      related_files: full.related_files,
      ready_for_test_design: full.ready_for_test_design,
      summary: full.summary,
    };
  })();

  const api = farmCtx.humanApiInput.ok ? farmCtx.humanApiInput : null;
  const web = farmCtx.humanWebpageInput.ok ? farmCtx.humanWebpageInput : null;

  return {
    orchestrator: {
      role: "orchestrator",
      ticket: `${s} — ${story.title}`,
      source: story.from_jira ? "JIRA live" : story.from_requirements ? "Requirements (pasted)" : "mock",
      stage: "1 — Orchestrator leads the pipeline",
      pipeline_plan: [
        "① Orchestrator assigns ticket → Requirement Analyst",
        "② Analyst extracts conditions + prerequisites → Validator checks (max 2 attempts)",
        "③ If prerequisites need human values → orchestrator pauses for your input",
        "④ Writer → Human input if story requires it → no simulated data before you provide it",
        "⑤ Data → Executor → Reviewer → Reporter (only after required input received)",
        "⑥ 1st validator fail → one retry · 2nd fail → run aborts",
      ],
      agents_in_pipeline: AGENT_ROLES,
      acceptance_criteria_count: story.acceptance_criteria,
      priority: story.priority,
      jira_status: story.status,
    },
    analyst: analystOutput,
    writer: { test_cases },
    test_data_extractor: buildTestDataExtractorOutput(story, api, test_cases, analystOutput, web),
    test_executor: buildTestExecutorOutput(story, api, web),
    reviewer: buildReviewerOutput(story, tcIds),
    reporter: buildReporterOutput(story, test_cases),
    validator: {
      role: "Output Validator",
      level: "L2",
      purpose: "Check worker outputs against role guidelines — never infinite retry",
      own_guidelines: VALIDATOR_GUIDELINES.rules,
      max_attempts_per_agent: VALIDATOR_MAX_ATTEMPTS,
      guidelines_enforced: Object.fromEntries(
        AGENT_ROLES.map((r) => [r, AGENT_GUIDELINES[r].rules]),
      ),
      validations: [],
    },
  };
}
'''
    (ROOT / "agents/pipeline.js").write_text(text)


def main():
    fix_registry()
    for f in ["analyst.js", "data-extractor.js", "executor.js", "validator.js", "orchestrator.js"]:
        process_agent_file(f)
    for f in ["geo.js", "test-data.js", "human-input.js", "story.js"]:
        process_lib_file(f)
    add_data_extractor_checks()
    rewrite_pipeline()
    print("finalized modules")


if __name__ == "__main__":
    main()
