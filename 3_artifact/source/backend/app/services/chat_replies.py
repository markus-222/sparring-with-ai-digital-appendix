"""Chat persistence helpers: store a message, finish a turn with its done event."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.schemas.chat import AgentName, ChatEvent, DoneEvent
from app.schemas.proposal import QuestionProposal, proposal_column


async def persist_message(
    db: AsyncSession,
    session_id: str,
    role: str,
    content: str,
    agent_name: str | None,
    tool_calls: dict[str, Any] | None = None,
    proposal: QuestionProposal | None = None,
) -> Message:
    message = Message(
        session_id=session_id,
        role=role,
        content=content,
        agent_name=agent_name,
        tool_calls=tool_calls,
        proposal=proposal_column(proposal),
        created_at=datetime.now(UTC),
    )
    db.add(message)
    await db.flush()
    return message


async def finish_reply(
    db: AsyncSession,
    session_id: str,
    label: str,
    agent: AgentName,
    content: str,
    *,
    pending: bool = False,
    tool_calls: dict[str, Any] | None = None,
    proposal: QuestionProposal | None = None,
) -> ChatEvent:
    """`tool_calls` is the turn record from `turn_record` (calls, transcript, asked slots)."""
    message = await persist_message(
        db, session_id, "assistant", content, agent, tool_calls, proposal
    )
    # get_db commits only after the response generator ends; the client must see durable state.
    await db.commit()
    return "done", DoneEvent(
        message_id=message.id,
        content=content,
        agent=agent,
        label=label,
        pending=pending,
        proposal=proposal,
    )
