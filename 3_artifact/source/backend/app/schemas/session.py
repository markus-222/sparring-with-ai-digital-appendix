"""Session Pydantic schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.schemas.proposal import QuestionProposal


class SessionCreate(BaseModel):
    project_id: str
    title: str | None = None


class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    agent_name: str | None = None
    tool_calls: Any | None = None
    proposal: QuestionProposal | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: str
    project_id: str
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SessionDetailResponse(SessionResponse):
    """Session with full message history (for GET /sessions/{id})."""

    messages: list[MessageResponse] = []


class ProposalResolveResponse(BaseModel):
    """Settled card, the confirmation message and where 03 changed (for the highlight)."""

    message_id: str
    proposal: QuestionProposal
    reply: MessageResponse | None = None
    artifact_id: str | None = None
    start: int | None = None
    end: int | None = None
