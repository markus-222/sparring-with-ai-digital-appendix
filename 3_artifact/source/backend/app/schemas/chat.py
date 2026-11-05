"""Chat request and the SSE payloads of POST /chat/stream."""

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.proposal import QuestionProposal

AgentName = Literal["analyst"]


class ChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=8000)
    open_artifact_id: str | None = None
    editor_open: bool = False
    comment_id: str | None = None


class LabelEvent(BaseModel):
    agent: AgentName
    label: str


class StatusEvent(BaseModel):
    message: str


class ArtifactChangedEvent(BaseModel):
    artifact_id: str
    start: int
    end: int


class OpenArtifactEvent(BaseModel):
    artifact_id: str


class ChipClearedEvent(BaseModel):
    pass


class RunStartedEvent(BaseModel):
    run_id: str


class DoneEvent(BaseModel):
    message_id: str
    content: str
    agent: AgentName
    label: str
    pending: bool
    proposal: QuestionProposal | None = None


class ProposalSettledEvent(BaseModel):
    message_id: str
    proposal: QuestionProposal


class ErrorEvent(BaseModel):
    message: str


ChatEvent = tuple[str, BaseModel | str]
