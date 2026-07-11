/** Maps each agent id to its skill folder and SKILL.md path (.cursor/skills/qa-*). */
export const AGENT_SKILLS = {
  orchestrator: {
    id: "orchestrator",
    folder: ".cursor/skills/qa-orchestrator",
    path: ".cursor/skills/qa-orchestrator/SKILL.md",
    module: "agents/orchestrator.js",
    level: "L1",
  },
  validator: {
    id: "validator",
    folder: ".cursor/skills/qa-validator",
    path: ".cursor/skills/qa-validator/SKILL.md",
    module: "agents/validator.js",
    level: "L2",
  },
  analyst: {
    id: "analyst",
    folder: ".cursor/skills/qa-analyst",
    path: ".cursor/skills/qa-analyst/SKILL.md",
    module: "agents/analyst.js",
    level: "L2",
  },
  writer: {
    id: "writer",
    folder: ".cursor/skills/qa-writer",
    path: ".cursor/skills/qa-writer/SKILL.md",
    module: "agents/writer.js",
    level: "L3",
  },
  test_data_extractor: {
    id: "test_data_extractor",
    folder: ".cursor/skills/qa-data-extractor",
    path: ".cursor/skills/qa-data-extractor/SKILL.md",
    module: "agents/data-extractor.js",
    level: "L3",
  },
  test_executor: {
    id: "test_executor",
    folder: ".cursor/skills/qa-executor",
    path: ".cursor/skills/qa-executor/SKILL.md",
    module: "agents/executor.js",
    level: "L3",
  },
  reviewer: {
    id: "reviewer",
    folder: ".cursor/skills/qa-reviewer",
    path: ".cursor/skills/qa-reviewer/SKILL.md",
    module: "agents/reviewer.js",
    level: "L4",
  },
  reporter: {
    id: "reporter",
    folder: ".cursor/skills/qa-reporter",
    path: ".cursor/skills/qa-reporter/SKILL.md",
    module: "agents/reporter.js",
    level: "L5",
  },
};

export function getSkillForAgent(agentId) {
  return AGENT_SKILLS[agentId] || null;
}

export function listAgentSkills() {
  return Object.values(AGENT_SKILLS);
}
