/**
 * QA Agent Farm — multi-module agent framework entry point.
 * Each agent module is paired with a skill folder under skills/.
 */

export {
  FALLBACK_STORIES,
  AGENT_ROLES,
  PIPELINE_STEPS,
  AGENT_META,
  AGENT_GUIDELINES,
  VALIDATOR_MAX_ATTEMPTS,
  ORCHESTRATOR_INACTIVITY_TIMEOUT_MS,
  VALIDATOR_GUIDELINES,
  OUTPUT_ROLES,
} from "./registry.js";

export { AGENT_ID as ANALYST_ID, SKILL_PATH as ANALYST_SKILL, storyForPrerequisiteDetection, buildAnalystOutputPayload, buildAnalystPrerequisitePayload } from "./analyst.js";
export { AGENT_ID as WRITER_ID, SKILL_PATH as WRITER_SKILL, tcType, buildWriterTestCases } from "./writer.js";
export { AGENT_ID as DATA_EXTRACTOR_ID, SKILL_PATH as DATA_EXTRACTOR_SKILL, buildTestDataExtractorOutput, blockedDataExtractorOutput } from "./data-extractor.js";
export { AGENT_ID as EXECUTOR_ID, SKILL_PATH as EXECUTOR_SKILL, buildTestExecutorOutput, blockedExecutorOutput } from "./executor.js";
export { AGENT_ID as REVIEWER_ID, SKILL_PATH as REVIEWER_SKILL, buildReviewerOutput } from "./reviewer.js";
export { AGENT_ID as REPORTER_ID, SKILL_PATH as REPORTER_SKILL, buildReporterOutput } from "./reporter.js";

export { AGENT_SKILLS, getSkillForAgent, listAgentSkills } from "../skills/index.js";

/** All worker + control agents with skill + module paths */
export const AGENT_FRAMEWORK = [
  { id: "orchestrator", module: "./orchestrator.js", skill: "skills/orchestrator/SKILL.md" },
  { id: "validator", module: "./validator.js", skill: "skills/validator/SKILL.md" },
  { id: "analyst", module: "./analyst.js", skill: "skills/analyst/SKILL.md" },
  { id: "writer", module: "./writer.js", skill: "skills/writer/SKILL.md" },
  { id: "test_data_extractor", module: "./data-extractor.js", skill: "skills/data-extractor/SKILL.md" },
  { id: "test_executor", module: "./executor.js", skill: "skills/executor/SKILL.md" },
  { id: "reviewer", module: "./reviewer.js", skill: "skills/reviewer/SKILL.md" },
  { id: "reporter", module: "./reporter.js", skill: "skills/reporter/SKILL.md" },
];
