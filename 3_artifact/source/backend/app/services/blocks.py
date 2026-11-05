"""Number a Markdown draft into addressable blocks; turn block edits into find/replace."""

import re
from dataclasses import dataclass
from typing import Literal

from app.schemas.review import (
    BlockEditProposal,
    ProposedComment,
    ReviewComment,
    TextChangeSuggestion,
    WorkshopQuestionSuggestion,
)
from app.services.edit_service import count_matches

BlockKind = Literal["heading", "list_item", "paragraph"]
BlockMode = Literal["replace", "insert_after"]

_HEADING_RE = re.compile(r"^#{1,6}\s")
_LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")


class BlockResolutionError(ValueError):
    """Raised when a block id is unknown or its text cannot be made unique."""


@dataclass(frozen=True)
class Block:
    id: str
    kind: BlockKind
    start: int
    end: int
    text: str


def split_blocks(content: str) -> list[Block]:
    """Split LF-normalized content into blocks; block.text is a verbatim substring."""
    content = content.replace("\r\n", "\n")
    blocks: list[Block] = []
    kind: BlockKind | None = None
    cur_start = 0
    cur_end = 0

    def flush() -> None:
        nonlocal kind
        if kind is not None:
            blocks.append(
                Block(f"B{len(blocks) + 1}", kind, cur_start, cur_end, content[cur_start:cur_end])
            )
            kind = None

    pos = 0
    for line in content.split("\n"):
        line_start, line_end = pos, pos + len(line)
        pos = line_end + 1
        if not line.strip():
            flush()
        elif _HEADING_RE.match(line):
            flush()
            kind, cur_start, cur_end = "heading", line_start, line_end
            flush()
        elif _LIST_RE.match(line):
            flush()
            kind, cur_start, cur_end = "list_item", line_start, line_end
        elif kind is not None:
            cur_end = line_end
        else:
            kind, cur_start, cur_end = "paragraph", line_start, line_end
    flush()
    return blocks


def render_numbered(blocks: list[Block]) -> str:
    return "\n".join(f"[{b.id}] {b.text}" for b in blocks)


def resolve_block_edit(content: str, block_id: str, mode: BlockMode, text: str) -> tuple[str, str]:
    """Return (find, replace) so that apply_edit(content, find, replace) hits exactly once.

    If the block text occurs more than once, the preceding blocks are prepended
    (verbatim) to both find and replace until the match is unique.
    """
    content = content.replace("\r\n", "\n")
    blocks = split_blocks(content)
    index = next((i for i, b in enumerate(blocks) if b.id == block_id), None)
    if index is None:
        raise BlockResolutionError(f"unknown block id {block_id!r}")
    block = blocks[index]
    first = index
    find = block.text
    while count_matches(content, find) != 1:
        if first == 0:
            raise BlockResolutionError(f"block {block_id} cannot be located uniquely")
        first -= 1
        find = content[blocks[first].start : block.end]
    if mode == "replace":
        replace = content[blocks[first].start : block.start] + text
    else:
        separator = "\n" if block.kind == "list_item" else "\n\n"
        replace = find + separator + text
    return find, replace


def resolve_proposed_comment(proposed: ProposedComment, content: str) -> ReviewComment:
    """Turn an LLM proposal into a stored comment; block edits become find/replace.

    Raises BlockResolutionError if a block id is unknown or cannot be located uniquely.
    """
    suggestion: TextChangeSuggestion | WorkshopQuestionSuggestion
    if isinstance(proposed.suggestion, BlockEditProposal):
        find, replace = resolve_block_edit(
            content,
            proposed.suggestion.block_id,
            proposed.suggestion.mode,
            proposed.suggestion.text,
        )
        suggestion = TextChangeSuggestion(find=find, replace=replace)
    else:
        suggestion = proposed.suggestion
    return ReviewComment(
        role=proposed.role,
        hypothesis=proposed.hypothesis,
        title=proposed.title,
        explanation=proposed.explanation,
        sources=proposed.sources,
        suggestion=suggestion,
    )
