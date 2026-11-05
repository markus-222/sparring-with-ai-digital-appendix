"""Conflict/unclear markers written by the Analyst."""

import re

MARKER_LINE = re.compile(r"^\s*(?:-\s*)?(?:⚠ CONFLICT|\? UNCLEAR)")


def extract_markers(content: str) -> list[str]:
    return [line.strip() for line in content.splitlines() if MARKER_LINE.match(line)]
