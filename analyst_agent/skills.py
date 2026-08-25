"""Skill loader — reads `skills/<name>/SKILL.md` (+ optional references/,
examples/, schemas/ subfolders) from disk.

Mirrors the frontmatter convention already used by every `SKILL.md` in this
repo (`.cursor/skills/`, `.claude/skills/`): a `---`-delimited YAML block
with at least `name` and `description`, followed by the prompt body.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

from .models import SkillName

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "skills"


class SkillLoadError(RuntimeError):
    pass


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    instructions: str
    """The SKILL.md body (everything after the frontmatter)."""
    path: Path
    references_dir: Optional[Path] = None
    examples_dir: Optional[Path] = None
    schemas_dir: Optional[Path] = None


def _existing_or_none(path: Path) -> Optional[Path]:
    return path if path.is_dir() else None


def _parse_skill_md(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise SkillLoadError(f"{path} is missing YAML frontmatter (must start with '---')")

    parts = text.split("---", 2)
    if len(parts) < 3:
        raise SkillLoadError(f"{path} has malformed frontmatter (expected a closing '---')")

    _blank, frontmatter_raw, body = parts
    frontmatter = yaml.safe_load(frontmatter_raw) or {}
    if not isinstance(frontmatter, dict):
        raise SkillLoadError(f"{path} frontmatter must be a YAML mapping")
    for required in ("name", "description"):
        if required not in frontmatter:
            raise SkillLoadError(f"{path} frontmatter is missing required key '{required}'")

    return frontmatter, body.strip()


def load_skill(name: SkillName | str) -> Skill:
    skill_name = SkillName(name) if not isinstance(name, SkillName) else name
    skill_dir = SKILLS_DIR / skill_name.value
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        raise SkillLoadError(
            f"No SKILL.md found for skill '{skill_name.value}' at {skill_md} "
            f"(expected skills/{skill_name.value}/SKILL.md)"
        )

    frontmatter, body = _parse_skill_md(skill_md)
    return Skill(
        name=frontmatter["name"],
        description=frontmatter["description"],
        instructions=body,
        path=skill_md,
        references_dir=_existing_or_none(skill_dir / "references"),
        examples_dir=_existing_or_none(skill_dir / "examples"),
        schemas_dir=_existing_or_none(skill_dir / "schemas"),
    )


def list_skills() -> list[Skill]:
    return [load_skill(name) for name in SkillName]
