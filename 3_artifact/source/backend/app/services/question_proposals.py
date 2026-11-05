"""Resolve a question proposal card: accept chosen questions into 03 or reject the card."""

import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.schemas.proposal import (
    ProposedQuestion,
    QuestionProposal,
    ResolveProposalRequest,
    proposal_column,
    read_proposal,
)
from app.services.chat_replies import persist_message
from app.services.chat_texts import (
    QUESTION_ALREADY_IN_03,
    QUESTION_DECLINED,
    QUESTIONS_ALREADY_IN_03,
    questions_added,
)
from app.services.open_issues_questions import QuestionAdded, add_questions_to_open_issues

ProposalErrorCode = Literal["not_found", "no_selection", "unknown_question", "editor_open"]


class ProposalError(Exception):
    def __init__(self, code: ProposalErrorCode) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ProposalOutcome:
    proposal: QuestionProposal
    added: QuestionAdded | None
    reply: Message | None


def new_proposal(items: list[tuple[str, str]], origin_artifact_id: str | None) -> QuestionProposal:
    return QuestionProposal(
        id=str(uuid.uuid4()),
        origin_artifact_id=origin_artifact_id,
        questions=[
            ProposedQuestion(id=str(uuid.uuid4()), title=title, text=text) for title, text in items
        ],
    )


async def lock_proposal_message(db: AsyncSession, session_id: str, message_id: str) -> Message:
    """The session's message with a row lock (a double click sees the settled card)."""
    result = await db.execute(
        select(Message)
        .where(Message.id == message_id, Message.session_id == session_id)
        .with_for_update()
    )
    message = result.scalar_one_or_none()
    if message is None or message.proposal is None:
        raise ProposalError("not_found")
    return message


async def settle_message(
    db: AsyncSession, message: Message, accepted_ids: set[str]
) -> QuestionProposal:
    proposal = read_proposal(message.proposal)
    if proposal is None:
        raise ProposalError("not_found")
    settled = proposal.settled(accepted_ids)
    message.proposal = proposal_column(settled)
    await db.flush()
    return settled


async def resolve_proposal(
    db: AsyncSession,
    project_id: str,
    session_id: str,
    message: Message,
    body: ResolveProposalRequest,
) -> ProposalOutcome:
    """Idempotent: a settled card is returned unchanged. Blocked adds raise QuestionBlockedError."""
    proposal = read_proposal(message.proposal)
    if proposal is None:
        raise ProposalError("not_found")
    if proposal.status != "open":
        return ProposalOutcome(proposal, None, None)
    if body.action == "reject":
        settled = await settle_message(db, message, set())
        reply = await persist_message(db, session_id, "assistant", QUESTION_DECLINED, "analyst")
        return ProposalOutcome(settled, None, reply)
    known = {q.id for q in proposal.questions}
    if not body.question_ids:
        raise ProposalError("no_selection")
    if not set(body.question_ids) <= known:
        raise ProposalError("unknown_question")
    if body.editor_open:
        raise ProposalError("editor_open")
    chosen = [q for q in proposal.questions if q.id in set(body.question_ids)]
    added = await add_questions_to_open_issues(
        db,
        project_id,
        [(q.title, q.text) for q in chosen],
        proposal.origin_artifact_id,
        revoke_approval=body.revoke,
    )
    settled = await settle_message(db, message, {q.id for q in chosen})
    if added.count == 0:
        text = QUESTION_ALREADY_IN_03 if len(chosen) == 1 else QUESTIONS_ALREADY_IN_03
    else:
        text = questions_added(added.count, created=added.created)
    reply = await persist_message(db, session_id, "assistant", text, "analyst")
    return ProposalOutcome(settled, added if added.count else None, reply)
