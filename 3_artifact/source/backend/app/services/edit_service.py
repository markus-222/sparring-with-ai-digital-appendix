"""apply_edit: whitespace/quote-tolerant find/replace with exactly-one-match semantics.

replace_section swaps one Markdown section, addressed by its heading."""

import re
from dataclasses import dataclass
from typing import Literal

_QUOTES = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‚": "'",
        "‛": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        "‟": '"',
    }
)
_HSPACE = " \t "


@dataclass(frozen=True)
class EditResult:
    status: Literal["applied", "not_found", "ambiguous"]
    content: str
    start: int | None = None
    end: int | None = None


def _normalize(text: str) -> tuple[str, list[int], list[int]]:
    """Normalize text; for every normalized char return its original span [start, end)."""
    chars: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "\r" and i + 1 < n and text[i + 1] == "\n":
            i += 1
            continue
        if ch in _HSPACE:
            j = i
            while j < n and text[j] in _HSPACE:
                j += 1
            chars.append(" ")
            starts.append(i)
            ends.append(j)
            i = j
            continue
        chars.append(ch.translate(_QUOTES))
        starts.append(i)
        ends.append(i + 1)
        i += 1
    return "".join(chars), starts, ends


def _positions(haystack: str, needle: str) -> list[int]:
    found: list[int] = []
    idx = haystack.find(needle)
    while idx != -1:
        found.append(idx)
        idx = haystack.find(needle, idx + 1)
    return found


def count_matches(content: str, find: str) -> int:
    needle = _normalize(find)[0]
    if not needle:
        return 0
    return len(_positions(_normalize(content)[0], needle))


def apply_edit(content: str, find: str, replace: str) -> EditResult:
    needle = _normalize(find)[0]
    if not needle:
        return EditResult("not_found", content)
    norm_content, starts, ends = _normalize(content)
    positions = _positions(norm_content, needle)
    if not positions:
        return EditResult("not_found", content)
    if len(positions) > 1:
        return EditResult("ambiguous", content)
    first = positions[0]
    orig_start = starts[first]
    orig_end = ends[first + len(needle) - 1]
    new_content = content[:orig_start] + replace + content[orig_end:]
    return EditResult("applied", new_content, orig_start, orig_start + len(replace))


_HEADING = re.compile(r"^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$")
_FENCE = re.compile(r"^[ \t]*(```|~~~)")


def _headings(content: str) -> list[tuple[int, int, str]]:
    """(offset, level, normalized title) of every Markdown heading outside code fences."""
    found: list[tuple[int, int, str]] = []
    offset = 0
    fenced = False
    for line in content.splitlines(keepends=True):
        stripped = line.rstrip("\r\n")
        if _FENCE.match(stripped):
            fenced = not fenced
        elif not fenced and (match := _HEADING.match(stripped)) is not None:
            found.append((offset, len(match.group(1)), _normalize(match.group(2))[0]))
        offset += len(line)
    return found


def replace_section(content: str, heading: str, replace: str) -> EditResult:
    """Replace the section under `heading`: its heading line and everything up to the next
    heading of the same or a higher level. An empty `replace` deletes the section."""
    wanted = _normalize(heading.strip().lstrip("#").strip())[0]
    if not wanted:
        return EditResult("not_found", content)
    headings = _headings(content)
    matches = [index for index, (_, _, title) in enumerate(headings) if title == wanted]
    if not matches:
        return EditResult("not_found", content)
    if len(matches) > 1:
        return EditResult("ambiguous", content)
    start, level, _ = headings[matches[0]]
    end = next(
        (offset for offset, other, _ in headings[matches[0] + 1 :] if other <= level),
        len(content),
    )
    rest = content[end:]
    body = replace.strip("\n")
    if body:
        body += "\n\n" if rest else "\n"
    return EditResult("applied", content[:start] + body + rest, start, start + len(body))
