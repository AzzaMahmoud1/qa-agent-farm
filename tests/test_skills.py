"""Tests for analyst_agent.skills — the SKILL.md loader."""

from __future__ import annotations

import pytest

from analyst_agent.models import SkillName
from analyst_agent.skills import SkillLoadError, list_skills, load_skill


def test_all_five_skills_load():
    skills = list_skills()
    assert {s.name for s in skills} == {name.value for name in SkillName}


def test_requirements_analysis_has_real_content():
    skill = load_skill(SkillName.REQUIREMENTS_ANALYSIS)
    assert skill.name == "requirements_analysis"
    assert "Never state a criterion the evidence does not support" in skill.instructions
    assert "insufficient_information" in skill.instructions
    assert skill.schemas_dir is not None
    assert (skill.schemas_dir / "output.schema.json").is_file()


def test_placeholder_skill_loads_with_no_extras():
    skill = load_skill(SkillName.SOURCE_ANALYSIS)
    assert skill.name == "source_analysis"
    assert skill.references_dir is None
    assert skill.examples_dir is None
    assert skill.schemas_dir is None


def test_load_skill_accepts_string_name():
    skill = load_skill("risk_analysis")
    assert skill.name == "risk_analysis"


def test_load_skill_rejects_unknown_name():
    with pytest.raises(ValueError):
        load_skill("not_a_real_skill")
