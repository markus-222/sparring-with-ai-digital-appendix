"""Deterministic format check: headings, items, sources, vague terms. No AI."""

import re
from collections.abc import Collection
from typing import Literal

from pydantic import BaseModel

from app.schemas.run import Slot
from app.services.artifact_templates import ArtifactTemplate, get_template, heading_pattern
from app.services.markers import MARKER_LINE

FindingCode = Literal[
    "empty",
    "missing_heading",
    "no_items",
    "missing_item_line",
    "missing_sources",
    "unknown_source",
    "vague_term",
]


class FormatFinding(BaseModel):
    code: FindingCode
    message: str
    detail: str | None = None


class FormatReport(BaseModel):
    findings: list[FormatFinding]

    @property
    def ok(self) -> bool:
        return not self.findings


_CITATION = re.compile(r"\[\[(doc|artifact):([^\]]+)\]\]")
_QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”')
_VAGUE_TERMS_EN = (
    "fast",
    "quick",
    "quickly",
    "easy",
    "easily",
    "user-friendly",
    "scalable",
    "efficient",
    "seamless",
    "high-performance",
    "high performance",
)
_GERMAN_ENDINGS = "(?:e|er|es|en|em)?"
_VAGUE_TERMS_DE = (
    "schnell",
    "zügig",
    "einfach",
    "benutzerfreundlich",
    "bedienerfreundlich",
    "intuitiv",
    "robust",
    "skalierbar",
    "effizient",
    "nahtlos",
    "modern",
    "performant",
    "leistungsfähig",
)
_VAGUE_PATTERNS: tuple[tuple[str, str], ...] = (
    *((term, re.escape(term)) for term in _VAGUE_TERMS_EN),
    *((term, re.escape(term) + _GERMAN_ENDINGS) for term in _VAGUE_TERMS_DE),
    ("flexibel", r"flexib(?:el|l(?:e|er|es|en|em))"),
)


def check_format(slot: Slot, content: str, *, known_documents: Collection[str]) -> FormatReport:
    if not content.strip():
        return FormatReport(findings=[FormatFinding(code="empty", message="The draft is empty.")])
    template = get_template(slot)
    lines = content.splitlines()
    findings = _check_headings(template, lines)
    if template.item_heading:
        findings += _check_items(template, template.item_heading, lines)
    if template.sources_required:
        findings += _check_sources(content, known_documents)
    findings += _check_vague_terms(content)
    return FormatReport(findings=findings)


def _check_headings(template: ArtifactTemplate, lines: list[str]) -> list[FormatFinding]:
    text = "\n".join(line.strip() for line in lines)
    return [
        FormatFinding(
            code="missing_heading",
            message=f"Required heading {heading} is missing (any language, same number).",
            detail=heading,
        )
        for heading in template.required_headings
        if heading_pattern(heading).search(text) is None
    ]


def _check_items(
    template: ArtifactTemplate, item_heading: str, lines: list[str]
) -> list[FormatFinding]:
    items: list[tuple[str, list[str]]] = []
    current: list[str] | None = None
    for line in lines:
        if line.startswith(f"{item_heading} "):
            current = []
            items.append((line[len(item_heading) :].strip(), current))
        elif line.startswith("#"):
            current = None
        elif current is not None:
            current.append(line.strip())
    if not items:
        return [FormatFinding(code="no_items", message=f"No {item_heading} items found.")]
    findings: list[FormatFinding] = []
    for title, body in items:
        for required in template.required_item_lines:
            if not any(line.startswith(required) for line in body):
                findings.append(
                    FormatFinding(
                        code="missing_item_line",
                        message=f'Item "{title}" lacks the line "{required}".',
                        detail=f"{title} / {required}",
                    )
                )
    return findings


def _check_sources(content: str, known_documents: Collection[str]) -> list[FormatFinding]:
    citations = _CITATION.findall(content)
    if not citations:
        return [
            FormatFinding(
                code="missing_sources", message="The draft cites no source ([[doc:...]])."
            )
        ]
    unknown: list[str] = []
    for kind, name in citations:
        name = name.strip()
        if kind == "doc" and name not in known_documents and name not in unknown:
            unknown.append(name)
    return [
        FormatFinding(
            code="unknown_source", message=f"Unknown document cited: {name}.", detail=name
        )
        for name in unknown
    ]


def _check_vague_terms(content: str) -> list[FormatFinding]:
    own_wording = "\n".join(
        _QUOTED.sub(" ", _CITATION.sub(" ", line))
        for line in content.splitlines()
        if not MARKER_LINE.match(line)
    ).lower()
    return [
        FormatFinding(
            code="vague_term",
            message=f'Vague term "{term}" in own wording: rephrase neutrally or delete.',
            detail=term,
        )
        for term, pattern in _VAGUE_PATTERNS
        if re.search(rf"\b{pattern}\b", own_wording)
    ]


def render_report(report: FormatReport) -> str:
    return "\n".join(f"- {finding.code}: {finding.message}" for finding in report.findings)
