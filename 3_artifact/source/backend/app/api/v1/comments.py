"""Comment endpoints: list and the four resolving actions. Ask lives in the chat."""

from collections.abc import Awaitable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.errors import conflict, require_unlocked
from app.database import get_db
from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.project import Project
from app.models.user import User
from app.schemas.review import (
    CommentActionResponse,
    CommentEdit,
    CommentResponse,
)
from app.services.chat_events import record_comment_resolved
from app.services.comment_actions import (
    ActionOutcome,
    CommentActionError,
    apply_comment,
    mark_done_manually,
    reject_comment,
)

router = APIRouter(prefix="/comments", tags=["comments"])

_ACTION_MESSAGES = {
    "not_open": "This comment is already resolved.",
    "wrong_edit_kind": "An edit must keep the kind of the suggestion.",
    "invalid_suggestion": "The stored suggestion is invalid.",
}


@router.get("", response_model=list[CommentResponse])
async def list_comments(
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Any]:
    """List every persisted comment for an artifact owned by the current
    user, ordered by number (monotonic, never reused across reviews)."""
    stmt = (
        select(Comment)
        .join(Artifact, Comment.artifact_id == Artifact.id)
        .join(Project, Artifact.project_id == Project.id)
        .where(Comment.artifact_id == artifact_id, Project.owner_id == current_user.id)
        .order_by(Comment.number)
    )
    return list((await db.execute(stmt)).scalars().all())


@router.post("/{comment_id}/accept", response_model=CommentActionResponse)
async def accept_comment(
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentActionResponse:
    comment = await _lock_comment(comment_id, current_user.id, db)
    return await _respond(db, comment, apply_comment(db, comment))


@router.post("/{comment_id}/edit", response_model=CommentActionResponse)
async def edit_comment(
    comment_id: str,
    body: CommentEdit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentActionResponse:
    comment = await _lock_comment(comment_id, current_user.id, db)
    return await _respond(db, comment, apply_comment(db, comment, edited=body.suggestion))


@router.post("/{comment_id}/reject", response_model=CommentActionResponse)
async def reject_comment_route(
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentActionResponse:
    comment = await _lock_comment(comment_id, current_user.id, db)
    return await _respond(db, comment, reject_comment(db, comment))


@router.post("/{comment_id}/done-manually", response_model=CommentActionResponse)
async def done_manually(
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CommentActionResponse:
    comment = await _lock_comment(comment_id, current_user.id, db)
    return await _respond(db, comment, mark_done_manually(db, comment))


async def _respond(
    db: AsyncSession, comment: Comment, action: Awaitable[ActionOutcome]
) -> CommentActionResponse:
    try:
        outcome = await action
    except CommentActionError as exc:
        raise conflict(exc.code, _ACTION_MESSAGES[exc.code]) from exc
    await record_comment_resolved(db, comment)
    return CommentActionResponse(outcome=outcome, comment=CommentResponse.model_validate(comment))


async def _lock_comment(comment_id: str, owner_id: str, db: AsyncSession) -> Comment:
    """Owned comment with a row lock (a double click sees the resolved status), 404 otherwise;
    409 while a run is active."""
    stmt = (
        select(Comment, Artifact.project_id)
        .join(Artifact, Comment.artifact_id == Artifact.id)
        .join(Project, Artifact.project_id == Project.id)
        .where(Comment.id == comment_id, Project.owner_id == owner_id)
        .with_for_update(of=Comment)
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    comment, project_id = row.tuple()
    await require_unlocked(db, project_id)
    return comment
