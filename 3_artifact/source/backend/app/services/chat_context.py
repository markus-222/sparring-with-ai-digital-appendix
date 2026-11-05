"""Chat context for the Analyst: sources, history and state."""

from collections import Counter
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.document import Document
from app.models.message import Message
from app.schemas.run import Slot
from app.schemas.tool_calls import read_turn_record
from app.services.approval_service import ApprovedArtifact, list_approved_foundation
from app.services.artifact_templates import TEMPLATES
from app.services.chat_events import list_recent_events
from app.services.chat_prompt import HistoryRow
from app.services.run_inputs import load_documents
from app.services.run_lock import get_active_run
from app.services.slot_service import SLOT_TYPES

HISTORY_LIMIT = 60
EVENT_LIMIT = 8
_SLOT_BY_TYPE = {template.type: template.slot for template in TEMPLATES}


@dataclass(frozen=True)
class OpenArtifact:
    id: str
    slot: Slot | None  # None: a free-form artifact
    status: str
    content: str
    open_comments: list[Comment]
    title: str = ""


@dataclass(frozen=True)
class ChatContext:
    state_summary: str
    history: list[HistoryRow]
    events: list[str]
    documents: list[Document]
    approved: list[ApprovedArtifact]  # all slots, the open one included
    open_artifact: OpenArtifact | None
    chip: Comment | None
    confirmable: frozenset[Slot]  # slots the latest assistant message asked to confirm


async def _open_comments(db: AsyncSession, artifact_id: str) -> list[Comment]:
    result = await db.execute(
        select(Comment)
        .where(Comment.artifact_id == artifact_id, Comment.status == "open")
        .order_by(Comment.number)
    )
    return list(result.scalars().all())


async def _load_open_artifact(
    db: AsyncSession, project_id: str, open_artifact_id: str | None
) -> OpenArtifact | None:
    if open_artifact_id is None:
        return None
    result = await db.execute(
        select(Artifact).where(Artifact.id == open_artifact_id, Artifact.project_id == project_id)
    )
    artifact = result.scalar_one_or_none()
    if artifact is None:
        return None
    return OpenArtifact(
        id=artifact.id,
        slot=_SLOT_BY_TYPE.get(artifact.type),
        status=artifact.status,
        content=artifact.content,
        open_comments=await _open_comments(db, artifact.id),
        title=artifact.title,
    )


async def _load_chip(
    db: AsyncSession, open_artifact: OpenArtifact | None, comment_id: str | None
) -> Comment | None:
    if open_artifact is None or comment_id is None:
        return None
    result = await db.execute(
        select(Comment).where(
            Comment.id == comment_id,
            Comment.artifact_id == open_artifact.id,
            Comment.status == "open",
        )
    )
    return result.scalar_one_or_none()


async def _load_history(
    db: AsyncSession, session_id: str
) -> tuple[list[HistoryRow], frozenset[Slot]]:
    """The newest chat rows, oldest first, and the slots the latest assistant row asked about."""
    result = await db.execute(
        select(Message.role, Message.content, Message.tool_calls)
        .where(Message.session_id == session_id, Message.role.in_(("user", "assistant")))
        .order_by(Message.created_at.desc(), Message.id)
        .limit(HISTORY_LIMIT)
    )
    history: list[HistoryRow] = []
    confirmable: frozenset[Slot] = frozenset()
    for role, content, stored in reversed(result.tuples().all()):
        if role == "assistant":
            record = read_turn_record(stored)
            history.append(HistoryRow(role=role, content=content, transcript=record.transcript))
            confirmable = frozenset(record.asked_slots)
        else:
            history.append(HistoryRow(role=role, content=content, transcript=[]))
    return history, confirmable


def _open_line(open_artifact: OpenArtifact | None) -> str:
    if open_artifact is None:
        return "open artifact: none"
    if open_artifact.slot is not None:
        return f"open artifact: {open_artifact.slot}"
    return f"open artifact: free-form artifact {open_artifact.id}"


async def _state_summary(
    db: AsyncSession, project_id: str, open_artifact: OpenArtifact | None, *, editor_open: bool
) -> str:
    artifact_rows = await db.execute(
        select(Artifact).where(Artifact.project_id == project_id, Artifact.type.in_(SLOT_TYPES))
    )
    by_type = {artifact.type: artifact for artifact in artifact_rows.scalars().all()}
    comment_rows = await db.execute(
        select(Comment.artifact_id)
        .join(Artifact, Comment.artifact_id == Artifact.id)
        .where(
            Artifact.project_id == project_id,
            Artifact.type.in_(SLOT_TYPES),
            Comment.status == "open",
        )
    )
    open_counts = Counter(comment_rows.scalars().all())
    lines: list[str] = []
    for template in TEMPLATES:
        artifact = by_type.get(template.type)
        status = "not_started" if artifact is None else artifact.status
        count = 0 if artifact is None else open_counts[artifact.id]
        lines.append(f"{template.slot} {template.title}: {status} (open comments: {count})")
    free_rows = await db.execute(
        select(Artifact.id, Artifact.title)
        .where(Artifact.project_id == project_id, Artifact.type.not_in(SLOT_TYPES))
        .order_by(Artifact.created_at, Artifact.id)
    )
    for free_id, title in free_rows.tuples().all():
        lines.append(f'free-form artifact "{title}": id {free_id}')
    lines.append(_open_line(open_artifact))
    active = await get_active_run(db, project_id)
    run = "idle" if active is None else f"active ({active.type} of {active.slot})"
    lines.append(f"run: {run}")
    lines.append(f"editor: {'open (unsaved edits)' if editor_open else 'closed'}")
    return "\n".join(lines)


async def build_chat_context(
    db: AsyncSession,
    project_id: str,
    session_id: str,
    *,
    open_artifact_id: str | None,
    comment_id: str | None,
    editor_open: bool,
) -> ChatContext:
    """Load everything one chat turn needs; call it before the user message is persisted."""
    open_artifact = await _load_open_artifact(db, project_id, open_artifact_id)
    history, confirmable = await _load_history(db, session_id)
    return ChatContext(
        state_summary=await _state_summary(db, project_id, open_artifact, editor_open=editor_open),
        history=history,
        events=await list_recent_events(db, session_id, limit=EVENT_LIMIT),
        documents=await load_documents(db, project_id),
        approved=await list_approved_foundation(db, project_id),
        open_artifact=open_artifact,
        chip=await _load_chip(db, open_artifact, comment_id),
        confirmable=confirmable,
    )
