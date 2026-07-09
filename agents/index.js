/**
 * QA Agent Farm — multi-module agent framework entry point.
 * createAgentFarm(ctx) wires runtime deps (mutable state, prerequisites, DOM helpers).
 */
import { setFarmCtx } from "./ctx-bridge.js";
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
import { inferHumanInputNeeds } from "../lib/human-input.js";
import { buildRequirementsFromStory, getLiveRequirements } from "../lib/requirements.js";

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

/**
 * @param {object} ctx - runtime deps: mutable state, prerequisites module, el(), helper fns
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
    inferHumanInputNeeds,
    buildRequirementsFromStory,
    getLiveRequirements,
  };
}
