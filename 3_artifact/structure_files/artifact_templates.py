"""Required structure per artifact slot - input for the format check.

Artifacts are written in the user's language, so the heading texts below are the English
reference only: a required heading is matched by its level and number (`## 3.`). Item lines
(`- Roles:`, `**Question:**`) are fixed tokens in every language.
"""

import re
from dataclasses import dataclass

from app.schemas.run import Slot


@dataclass(frozen=True)
class ArtifactTemplate:
    slot: Slot
    type: str
    title: str
    required_headings: tuple[str, ...]
    item_heading: str | None
    required_item_lines: tuple[str, ...]
    sources_required: bool


# Chat-added questions go in front of this heading: the sections from here on hold no items.
OPEN_ISSUES_ITEMS_END = "## 4. Documents & Data to Request in Advance"

TEMPLATES: tuple[ArtifactTemplate, ...] = (
    ArtifactTemplate(
        slot="01",
        type="project_description",
        title="Problem- and Scope-Definition",
        required_headings=(
            "## 1. Executive Summary",
            "## 2. Context & Stakeholders",
            "## 3. Problem Space",
            "## 4. Goals & Success Criteria",
            "## 5. Scope Definition",
            "## 6. Project Requirements & Constraints",
        ),
        item_heading=None,
        required_item_lines=(),
        sources_required=True,
    ),
    ArtifactTemplate(
        slot="02",
        type="stakeholder_analysis",
        title="Stakeholder Analysis",
        required_headings=(
            "## 1. Stakeholder Identification & Classification",
            "## 2. Gaps in Participation (Blind Spots)",
            "## 3. Stakeholder Needs & Concerns",
            "## 4. Potential Conflicts & Tensions",
            "## 5. Potentially Negatively Affected Stakeholders",
            "## 6. Uncertainties & Assumptions",
        ),
        item_heading="###",
        required_item_lines=("- Roles:", "- Influence:"),
        sources_required=True,
    ),
    ArtifactTemplate(
        slot="03",
        type="open_issues",
        title="Open Issues & Workshop Questions",
        required_headings=(),
        item_heading="###",
        required_item_lines=("**Question:**",),
        sources_required=False,
    ),
)


def get_template(slot: Slot) -> ArtifactTemplate:
    return next(t for t in TEMPLATES if t.slot == slot)


def slot_for_type(artifact_type: str) -> Slot | None:
    return next((t.slot for t in TEMPLATES if t.type == artifact_type), None)


_NUMBERED_HEADING = re.compile(r"^(#+ \d+\.)\s")


def heading_pattern(heading: str) -> re.Pattern[str]:
    """Matches a heading line with the same level and number as `heading`, in any language."""
    match = _NUMBERED_HEADING.match(heading)
    if match is None:
        raise ValueError(f"not a numbered heading: {heading}")
    return re.compile(rf"^{re.escape(match.group(1))}(?:[ \t].*)?$", re.MULTILINE)
