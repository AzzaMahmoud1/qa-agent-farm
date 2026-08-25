"""Standalone Python QA Analyst agent.

Parallel to (not a replacement for) the existing prompt-driven Analyst in
`.cursor/skills/qa-analyst/` / `.claude/skills/qa-analyst/` and the JS
implementations in `agents/analyst.js` / `src/agents/requirementAnalyst.js`.
Nothing here is wired into the JS pipeline.
"""

from .models import SkillName

__all__ = ["SkillName"]
