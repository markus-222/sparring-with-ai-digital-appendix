"""Comment actions: accept, edit, reject, done manually. No AI."""

from typing import Any, Literal

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.workshop_question import WorkshopQuestion
from app.schemas.review import Suggestion, TextChangeSuggestion, WorkshopQuestionSuggestion
from app.services.edit_service import apply_edit

ActionOutcome = Literal["applied", "question_added", "not_located", "rejected", "done_manually"]
ActionFailure = Literal["not_open", "wrong_edit_kind", "invalid_suggestion"]

_SUGGESTION: TypeAdapter[TextChangeSuggestion | WorkshopQuestionSuggestion] = TypeAdapter(
    Suggestion
)


class CommentActionError(Exception):
    def __init__(self, code: ActionFailure) -> None:
        super().__init__(code)
        self.code = code


def read_suggestion(raw: dict[str, Any] | None) -> Suggestion:
    try:
        return _SUGGESTION.validate_python(raw)
    except ValidationError as exc:
        raise CommentActionError("invalid_suggestion") from exc


def _require_open(comment: Comment) -> None:
    if comment.status != "open":
        raise CommentActionError("not_open")


async def apply_comment(
    db: AsyncSession, comment: Comment, *, edited: Suggestion | None = None
) -> ActionOutcome:
    _require_open(comment)
    stored = read_suggestion(comment.suggestion)
    suggestion = stored if edited is None else edited
    if edited is not None and edited.kind != stored.kind:
        raise CommentActionError("wrong_edit_kind")
    artifact = (
        await db.execute(
            select(Artifact).where(Artifact.id == comment.artifact_id).with_for_update()
        )
    ).scalar_one()
    outcome: ActionOutcome
    if isinstance(suggestion, TextChangeSuggestion):
        result = apply_edit(artifact.content, suggestion.find, suggestion.replace)
        if result.status != "applied":
            return "not_located"
        artifact.content = result.content
        outcome = "applied"
    else:
        db.add(
            WorkshopQuestion(
                project_id=artifact.project_id,
                text=suggestion.text,
                origin_artifact_id=artifact.id,
                origin_comment_id=comment.id,
            )
        )
        outcome = "question_added"
    comment.status = "accepted" if edited is None else "edited"
    if edited is not None:
        comment.suggestion = edited.model_dump()
    await db.flush()
    return outcome


async def reject_comment(db: AsyncSession, comment: Comment) -> ActionOutcome:
    _require_open(comment)
    comment.status = "rejected"
    await db.flush()
    return "rejected"


async def mark_done_manually(db: AsyncSession, comment: Comment) -> ActionOutcome:
    _require_open(comment)
    comment.status = "done_manually"
    await db.flush()
    return "done_manually"
