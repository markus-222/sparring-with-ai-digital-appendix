"""Preconditions the API checks before a run starts."""

from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.comment import Comment
from app.schemas.run import RunType, Slot
from app.services.slot_service import get_slot_artifact

PreconditionFailure = Literal["not_draft", "empty_draft", "open_comments"]

_MESSAGES: dict[PreconditionFailure, str] = {
    "not_draft": "Create a draft first.",
    "empty_draft": "The draft is empty.",
    "open_comments": "Resolve all open comments first.",
}


class RunPreconditionError(Exception):
    def __init__(self, code: PreconditionFailure) -> None:
        super().__init__(_MESSAGES[code])
        self.code = code


async def check_run_preconditions(
    db: AsyncSession, project_id: str, run_type: RunType, slot: Slot
) -> None:
    if run_type != "review":
        return
    artifact = await get_slot_artifact(db, project_id, slot)
    if artifact.status != "draft":
        raise RunPreconditionError("not_draft")
    if not artifact.content.strip():
        raise RunPreconditionError("empty_draft")
    open_comments = (
        await db.execute(
            select(func.count())
            .select_from(Comment)
            .where(Comment.artifact_id == artifact.id, Comment.status == "open")
        )
    ).scalar_one()
    if open_comments:
        raise RunPreconditionError("open_comments")
