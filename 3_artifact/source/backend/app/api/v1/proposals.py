"""Question proposal cards: accept or reject a card of an assistant message."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.errors import conflict, verify_session_owner
from app.database import get_db
from app.models.user import User
from app.schemas.proposal import ResolveProposalRequest
from app.schemas.session import MessageResponse, ProposalResolveResponse
from app.services.open_issues_questions import QuestionBlockedError
from app.services.question_proposals import (
    ProposalError,
    lock_proposal_message,
    resolve_proposal,
)

router = APIRouter(tags=["proposals"])

_ERROR_MESSAGES = {
    "no_selection": "Select at least one question.",
    "unknown_question": "The selection contains a question that is not part of the proposal.",
    "editor_open": "Save or discard your changes first.",
}


@router.post("/{session_id}/proposals/{message_id}/resolve", response_model=ProposalResolveResponse)
async def resolve(
    session_id: str,
    message_id: str,
    body: ResolveProposalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProposalResolveResponse:
    session = await verify_session_owner(db, session_id, current_user.id)
    try:
        message = await lock_proposal_message(db, session.id, message_id)
    except ProposalError as exc:
        raise HTTPException(status_code=404, detail="Proposal not found") from exc
    try:
        outcome = await resolve_proposal(db, session.project_id, session.id, message, body)
    except ProposalError as exc:
        raise conflict(exc.code, _ERROR_MESSAGES[exc.code]) from exc
    except QuestionBlockedError as exc:
        if exc.code == "approved":
            raise conflict(
                "needs_revoke", "03 is approved. Accepting revokes the approval."
            ) from exc
        raise conflict("run_active", "A run is active. Please wait until it has finished.") from exc
    added = outcome.added
    return ProposalResolveResponse(
        message_id=message.id,
        proposal=outcome.proposal,
        reply=None if outcome.reply is None else MessageResponse.model_validate(outcome.reply),
        artifact_id=None if added is None else added.artifact_id,
        start=None if added is None else added.start,
        end=None if added is None else added.end,
    )
