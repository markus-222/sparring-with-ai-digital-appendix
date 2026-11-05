"""Message in the active chat right after an approval: names the next step."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.message import Message
from app.models.session import Session
from app.schemas.run import Slot
from app.services.artifact_templates import TEMPLATES, get_template, slot_for_type
from app.services.chat_replies import persist_message
from app.services.slot_service import SLOT_TYPES


def _name(slot: Slot) -> str:
    return f"{slot} {get_template(slot).title}"


def approval_text(approved_slot: Slot, slots: list[tuple[Slot, str]]) -> str:
    """German text for the approval of `approved_slot`; `slots` are (slot, status) for 01-03."""
    head = f"{_name(approved_slot)} ist freigegeben."
    for slot, status in sorted(slots):
        if slot == approved_slot or status == "approved":
            continue
        if status == "draft":
            return (
                f"{head} Als Nächstes steht {_name(slot)} an; der Entwurf dazu liegt bereits vor."
            )
        return (
            f"{head} Als Nächstes bietet sich {_name(slot)} an. Soll ich einen Entwurf erstellen?"
        )
    return f"{head} Damit sind alle drei Artefakte freigegeben."


async def write_approval_message(
    db: AsyncSession, artifact: Artifact, session_id: str | None
) -> Message | None:
    """Persist the approval text in the session; None without a matching session or slot."""
    slot = slot_for_type(artifact.type)
    if session_id is None or slot is None:
        return None
    session = await db.get(Session, session_id)
    if session is None or session.project_id != artifact.project_id:
        return None
    rows = await db.execute(
        select(Artifact.type, Artifact.status).where(
            Artifact.project_id == artifact.project_id, Artifact.type.in_(SLOT_TYPES)
        )
    )
    status_by_type = dict(rows.tuples().all())
    slots = [(t.slot, status_by_type.get(t.type, "not_started")) for t in TEMPLATES]
    return await persist_message(db, session_id, "assistant", approval_text(slot, slots), "analyst")
