"""Grounding validation — verify every claim traces to real evidence.

The model asserts that each acceptance criterion is supported by a verbatim
`evidence_quote` from a named `source_field`. This module checks that claim
against the actual evidence instead of trusting it. A criterion whose quote
does not appear in the named field is an unsupported claim, and unsupported
claims must never be passed downstream as verified.

Normalization is deliberately conservative: whitespace is collapsed and the
comparison is case-insensitive (models reflow and re-case quotes when
copying), but the *words themselves* must match. Paraphrase fails.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Mapping, Optional

from .models import BaseAnalysisResult, GroundedFinding, RootCauseAnalysisResult

#: Quotes shorter than this are too weak to establish grounding — a
#: three-character "the" appears in any document.
MIN_QUOTE_CHARS = 12

_WHITESPACE_RE = re.compile(r"\s+")
#: Unicode punctuation models commonly normalize when copying text.
_PUNCT_FOLD = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-",
    "—": "-", "―": "-", "−": "-",
    " ": " ", "…": "...",
}


def normalize(text: str) -> str:
    """Collapse whitespace, fold smart punctuation, casefold.

    Intentionally does NOT stem, drop stopwords, or fuzzy-match — those would
    let paraphrase pass as a verbatim quote, which is exactly what this
    module exists to catch.
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = "".join(_PUNCT_FOLD.get(ch, ch) for ch in text)
    text = _WHITESPACE_RE.sub(" ", text)
    return text.strip().casefold()


@dataclass
class GroundingReport:
    ok: bool
    failures: list[str] = field(default_factory=list)
    #: Indices of acceptance_criteria whose quote could not be verified.
    ungrounded_indices: list[int] = field(default_factory=list)
    checked: int = 0

    def __bool__(self) -> bool:
        return self.ok


def flatten_evidence(evidence: Mapping[str, object]) -> dict[str, str]:
    """Flatten nested evidence into `field_path -> text`.

    Lists become indexed paths (`comments[0]`) so a criterion can cite a
    specific comment rather than the whole blob. Also emits parent paths so
    citing `comments` wholesale still resolves.
    """
    flat: dict[str, str] = {}

    def walk(node: object, path: str) -> None:
        if isinstance(node, Mapping):
            for key, value in node.items():
                walk(value, f"{path}.{key}" if path else str(key))
        elif isinstance(node, (list, tuple)):
            joined = []
            for i, value in enumerate(node):
                walk(value, f"{path}[{i}]")
                if isinstance(value, str):
                    joined.append(value)
                elif isinstance(value, Mapping):
                    joined.extend(str(v) for v in value.values() if isinstance(v, str))
            if joined and path:
                flat[path] = "\n".join(joined)
        elif node is not None:
            flat[path] = str(node)

    walk(evidence, "")
    return flat


def _resolve_field(flat: dict[str, str], source_field: str) -> Optional[str]:
    """Look up a cited field, tolerating leading/trailing whitespace and
    the common `fields.description` vs `description` prefix difference."""
    key = source_field.strip()
    if key in flat:
        return flat[key]
    for candidate, value in flat.items():
        if candidate.endswith(f".{key}") or candidate == key:
            return value
    return None


def check_quote_grounded(
    quote: str, source_field: str, flat_evidence: dict[str, str]
) -> tuple[bool, str]:
    """Return (ok, reason). Reason is empty when ok."""
    if len(quote.strip()) < MIN_QUOTE_CHARS:
        return False, (
            f"evidence_quote is too short to establish grounding "
            f"({len(quote.strip())} chars, minimum {MIN_QUOTE_CHARS})"
        )

    field_text = _resolve_field(flat_evidence, source_field)
    if field_text is None:
        available = ", ".join(sorted(flat_evidence)) or "(no evidence fields)"
        return False, (
            f"source_field {source_field!r} does not exist in the evidence. "
            f"Available fields: {available}"
        )

    if normalize(quote) not in normalize(field_text):
        return False, (
            f"evidence_quote does not appear verbatim in {source_field!r} — "
            f"paraphrase and invented quotes are not valid grounding "
            f"(quote: {quote[:80]!r})"
        )

    return True, ""


def check_grounding(
    result: BaseAnalysisResult, evidence: Mapping[str, object]
) -> GroundingReport:
    """Verify every finding against the real evidence.

    Works across all skills via `BaseAnalysisResult.findings()`. For
    root-cause analysis it additionally walks each why-chain, since a step
    claiming to be 'evidenced' must carry a quote that actually resolves —
    otherwise the chain launders a hypothesis into a fact.
    """
    flat = flatten_evidence(evidence)
    failures: list[str] = []
    ungrounded: list[int] = []

    findings = result.findings()
    for i, finding in enumerate(findings):
        ok, reason = check_quote_grounded(
            finding.evidence_quote, finding.source_field, flat
        )
        if not ok:
            ungrounded.append(i)
            failures.append(f"findings[{i}]: {reason}")

    if isinstance(result, RootCauseAnalysisResult):
        for i, cause in enumerate(result.root_causes):
            for j, step in enumerate(cause.why_chain):
                if step.support != "evidenced":
                    continue
                ok, reason = check_quote_grounded(
                    step.evidence_quote or "", step.source_field or "", flat
                )
                if not ok:
                    if i not in ungrounded:
                        ungrounded.append(i)
                    failures.append(
                        f"root_causes[{i}].why_chain[{j}] claims to be evidenced: {reason}"
                    )

    return GroundingReport(
        ok=not failures,
        failures=failures,
        ungrounded_indices=sorted(ungrounded),
        checked=len(findings),
    )


def strip_ungrounded(
    result: BaseAnalysisResult, report: GroundingReport
) -> BaseAnalysisResult:
    """Drop criteria that failed grounding, so nothing unsupported is ever
    returned as verified. Callers still surface the failure — this is for the
    degraded path where a partially-valid result is better than nothing."""
    if report.ok:
        return result
    bad = set(report.ungrounded_indices)
    keep = [f for i, f in enumerate(result.findings()) if i not in bad]
    return result.with_findings(keep)


def unsupported_claim_count(
    result: BaseAnalysisResult, evidence: Mapping[str, object]
) -> int:
    """Convenience for eval scoring: how many findings are ungrounded."""
    return len(check_grounding(result, evidence).ungrounded_indices)


def criterion_is_grounded(
    criterion: GroundedFinding, evidence: Mapping[str, object]
) -> bool:
    ok, _reason = check_quote_grounded(
        criterion.evidence_quote, criterion.source_field, flatten_evidence(evidence)
    )
    return ok
