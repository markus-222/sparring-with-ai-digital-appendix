"""Prompt assembly for the Analyst chat: pure functions from loaded data to LLM messages.

Layout, most stable first, so the provider can cache the prefix: system instructions, customer
documents, approved artifacts, history (with earlier tool calls), then the volatile turn block
and the user message.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.models.comment import Comment
from app.models.document import Document
from app.schemas.run import Slot
from app.services.approval_service import ApprovedArtifact
from app.services.artifact_templates import slot_for_type

if TYPE_CHECKING:
    from app.services.chat_context import OpenArtifact


@dataclass(frozen=True)
class HistoryRow:
    role: str  # "user" | "assistant"
    content: str
    transcript: list[dict[str, Any]]  # empty for user rows and plain assistant rows


def _slot(artifact_type: str) -> Slot:
    slot = slot_for_type(artifact_type)
    if slot is None:
        raise ValueError(f"No slot for artifact type {artifact_type!r}")
    return slot


def _cached_text(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}


def expand_history(rows: Sequence[HistoryRow]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for row in rows:
        if row.transcript:
            messages.extend(row.transcript)
        else:
            messages.append({"role": row.role, "content": row.content})
    return messages


def documents_block(documents: Sequence[Document]) -> str:
    return "\n\n".join(
        f'<document name="{d.filename}">\n{d.full_text}\n</document>'
        for d in documents
        if d.full_text
    )


def approved_block(approved: Sequence[ApprovedArtifact]) -> str:
    return "\n\n".join(
        f'<approved slot="{_slot(item.type)}" version="{item.version_no}" '
        f'current_status="{item.current_status}">\n{item.content}\n</approved>'
        for item in approved
    )


def _open_artifact_block(open_artifact: "OpenArtifact") -> str:
    slot = open_artifact.slot
    if slot is None:
        return (
            f'<open_artifact id="{open_artifact.id}" title="{open_artifact.title}" '
            f'status="free-form">\n{open_artifact.content}\n</open_artifact>'
        )
    body = (
        f'Identical to the <approved slot="{slot}"> block.'
        if open_artifact.status == "approved"
        else open_artifact.content
    )
    return (
        f'<open_artifact slot="{slot}" status="{open_artifact.status}">\n{body}\n</open_artifact>'
    )


def _chip_block(chip: Comment) -> str:
    lines = [f"Title: {chip.title}", f"Description: {chip.description}"]
    if chip.suggestion is not None:
        lines.append(f"Suggestion: {json.dumps(chip.suggestion, ensure_ascii=False)}")
    return f'<chip id="{chip.id}">\n' + "\n".join(lines) + "\n</chip>"


def turn_block(
    *,
    state: str,
    open_artifact: "OpenArtifact | None",
    chip: Comment | None,
    events: Sequence[str],
) -> str:
    parts = [f"<state>\n{state}\n</state>"]
    if open_artifact is not None:
        parts.append(_open_artifact_block(open_artifact))
        if open_artifact.open_comments:
            lines = "\n".join(
                f"- #{c.number} {c.title}: {c.description}" for c in open_artifact.open_comments
            )
            parts.append(f"<open_comments>\n{lines}\n</open_comments>")
    if chip is not None:
        parts.append(_chip_block(chip))
    if events:
        lines = "\n".join(f"- {event}" for event in events)
        parts.append(f"<events>\n{lines}\n</events>")
    return "\n\n".join(parts)


def _last_text_index(history: Sequence[dict[str, Any]]) -> int | None:
    for index in range(len(history) - 1, -1, -1):
        message = history[index]
        content = message.get("content")
        if message.get("role") in ("user", "assistant") and isinstance(content, str) and content:
            return index
    return None


def build_messages(
    *,
    system_prompt: str,
    documents: str,
    approved: str,
    history: list[dict[str, Any]],
    turn: str,
    user_message: str,
) -> list[dict[str, Any]]:
    """At most four cache markers: documents, approved, last history text message, user message."""
    system_blocks: list[dict[str, Any]] = [{"type": "text", "text": system_prompt}]
    system_blocks += [_cached_text(text) for text in (documents, approved) if text]
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_blocks}, *history]
    marked = _last_text_index(history)
    if marked is not None:
        message = history[marked]
        messages[marked + 1] = {**message, "content": [_cached_text(message["content"])]}
    messages.append(
        {
            "role": "user",
            "content": [_cached_text(f"{turn}\n\n<user_message>\n{user_message}\n</user_message>")],
        }
    )
    return messages
