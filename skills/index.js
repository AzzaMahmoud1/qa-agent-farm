/** Maps each agent id to its skill folder and SKILL.md path */
const AGENT_SKILLS = {
  orchestrator: {
    id: "orchestrator",
    folder: "skills/orchestrator",
    path: "skills/orchestrator/SKILL.md",
    module: "agents/orchestrator.js",
    level: "L1",
  },
  validator: {
    id: "validator",
    folder: "skills/validator",
    path: "skills/validator/SKILL.md",
    module: "agents/validator.js",
    level: "L2",
  },
  analyst: {
    id: "analyst",
    folder: "skills/analyst",
    path: "skills/analyst/SKILL.md",
    module: "agents/analyst.js",
    level: "L2",
  },
  writer: {
    id: "writer",
    folder: "skills/writer",
    path: "skills/writer/SKILL.md",
    module: "agents/writer.js",
    level: "L3",
  },
  test_data_extractor: {
    id: "test_data_extractor",
    folder: "skills/data-extractor",
    path: "skills/data-extractor/SKILL.md",
    module: "agents/data-extractor.js",
    level: "L3",
  },
  test_executor: {
    id: "test_executor",
    folder: "skills/executor",
    path: "skills/executor/SKILL.md",
    module: "agents/executor.js",
    level: "L3",
  },
  reviewer: {
    id: "reviewer",
    folder: "skills/reviewer",
    path: "skills/reviewer/SKILL.md",
    module: "agents/reviewer.js",
    level: "L4",
  },
  reporter: {
    id: "reporter",
    folder: "skills/reporter",
    path: "skills/reporter/SKILL.md",
    module: "agents/reporter.js",
    level: "L5",
  },
};

function getSkillForAgent(agentId) {
  return AGENT_SKILLS[agentId] || null;
}

function listAgentSkills() {
  return Object.values(AGENT_SKILLS);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { AGENT_SKILLS, getSkillForAgent, listAgentSkills };
}
