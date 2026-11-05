"""Chat-driven artifact change: exact find/replace or a rewrite of a section or the whole
text; mirrors PUT /artifacts/{id}."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.services.edit_service import EditResult, apply_edit, replace_section
from app.services.run_lock import ProjectLockedError, assert_project_unlocked

ChangeFailure = Literal["not_found", "ambiguous", "locked", "empty_find"]


class ChangeError(Exception):
    def __init__(self, code: ChangeFailure, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ChangeResult:
    artifact_id: str
    start: int
    end: int
    was_approved: bool


async def _assert_unlocked(db: AsyncSession, artifact: Artifact) -> None:
    try:
        await assert_project_unlocked(db, artifact.project_id)
    except ProjectLockedError as exc:
        raise ChangeError("locked", "A run is active for this project.") from exc


async def _store(db: AsyncSession, artifact: Artifact, edit: EditResult) -> ChangeResult:
    if edit.status == "ambiguous":
        raise ChangeError("ambiguous", "The text to find occurs more than once.")
    if edit.status != "applied" or edit.start is None or edit.end is None:
        raise ChangeError("not_found", "The text to find was not found.")
    was_approved = artifact.status == "approved"
    artifact.content = edit.content
    artifact.reviewed_since_change = False
    if was_approved:
        artifact.status = "draft"
    await db.flush()
    return ChangeResult(
        artifact_id=artifact.id, start=edit.start, end=edit.end, was_approved=was_approved
    )


async def apply_chat_change(
    db: AsyncSession, artifact: Artifact, find: str, replace: str
) -> ChangeResult:
    await _assert_unlocked(db, artifact)
    if not find:
        raise ChangeError("empty_find", "The text to find must not be empty.")
    return await _store(db, artifact, apply_edit(artifact.content, find, replace))


async def apply_chat_rewrite(
    db: AsyncSession, artifact: Artifact, content: str, heading: str | None
) -> ChangeResult:
    """Replace the section under `heading`, or the whole text when `heading` is None."""
    await _assert_unlocked(db, artifact)
    if heading is None:
        edit = EditResult("applied", content, 0, len(content))
    else:
        edit = replace_section(artifact.content, heading, content)
    return await _store(db, artifact, edit)
