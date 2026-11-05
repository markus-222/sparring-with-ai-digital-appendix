"""Greeting of a new chat: the first assistant message, derived from the artifact state."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.services.artifact_templates import TEMPLATES
from app.services.chat_replies import persist_message
from app.services.chat_texts import greeting_for
from app.services.slot_service import SLOT_TYPES


async def create_greeting(db: AsyncSession, project_id: str, session_id: str) -> None:
    rows = await db.execute(
        select(Artifact.type, Artifact.status).where(
            Artifact.project_id == project_id, Artifact.type.in_(SLOT_TYPES)
        )
    )
    status_by_type = dict(rows.tuples().all())
    slots: list[tuple[str, str]] = [
        (t.slot, status_by_type.get(t.type, "not_started")) for t in TEMPLATES
    ]
    await persist_message(db, session_id, "assistant", greeting_for(slots), "analyst")
