"""System events shown to the agents as chat context but hidden from the chat list (P5)."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.message import Message
from app.models.session import Session
from app.schemas.run import Slot
from app.services.artifact_templates import slot_for_type

EVENT_ROLE = "system"
EVENT_AGENT = "event"


def approved_text(slot: Slot) -> str:
    return f"Artifact {slot} approved."


def saved_text(slot: Slot) -> str:
    return f"Artifact {slot} saved by the user."


def deleted_text(slot: Slot) -> str:
    return f"Artifact {slot} deleted by the user; it is not started again."


def comment_resolved_text(title: str, status: str) -> str:
    return f"Comment '{title}' resolved ({status})."


async def record_event(db: AsyncSession, project_id: str, text: str) -> None:
    """Write an event into the project's latest session; no session means no-op."""
    result = await db.execute(
        select(Session.id)
        .where(Session.project_id == project_id)
        .order_by(Session.created_at.desc(), Session.id)
        .limit(1)
    )
    session_id = result.scalar_one_or_none()
    if session_id is None:
        return
    # Python-side timestamp: the server default now() is identical within one transaction.
    db.add(
        Message(
            session_id=session_id,
            role=EVENT_ROLE,
            content=text,
            agent_name=EVENT_AGENT,
            created_at=datetime.now(UTC),
        )
    )
    await db.flush()


async def list_recent_events(db: AsyncSession, session_id: str, limit: int = 5) -> list[str]:
    """Return the newest `limit` event texts, oldest first."""
    result = await db.execute(
        select(Message.content)
        .where(
            Message.session_id == session_id,
            Message.role == EVENT_ROLE,
            Message.agent_name == EVENT_AGENT,
        )
        .order_by(Message.created_at.desc(), Message.id)
        .limit(limit)
    )
    return list(reversed(result.scalars().all()))


async def record_artifact_approved(db: AsyncSession, artifact: Artifact) -> None:
    slot = slot_for_type(artifact.type)
    if slot is not None:
        await record_event(db, artifact.project_id, approved_text(slot))


async def record_artifact_saved(db: AsyncSession, artifact: Artifact) -> None:
    slot = slot_for_type(artifact.type)
    if slot is not None:
        await record_event(db, artifact.project_id, saved_text(slot))


async def record_artifact_deleted(db: AsyncSession, artifact: Artifact) -> None:
    slot = slot_for_type(artifact.type)
    if slot is not None:
        await record_event(db, artifact.project_id, deleted_text(slot))


async def record_comment_resolved(db: AsyncSession, comment: Comment) -> None:
    if comment.status == "open":
        return
    result = await db.execute(select(Artifact.project_id).where(Artifact.id == comment.artifact_id))
    project_id = result.scalar_one()
    await record_event(db, project_id, comment_resolved_text(comment.title, comment.status))
