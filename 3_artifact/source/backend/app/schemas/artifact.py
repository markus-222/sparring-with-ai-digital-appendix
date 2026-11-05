"""Artifact Pydantic schemas."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.run import Slot
from app.schemas.session import MessageResponse

ArtifactStatus = Literal["not_started", "draft", "approved"]


class ArtifactUpdate(BaseModel):
    """Partial update for an existing artifact (manual edit)."""

    title: str | None = None
    content: str | None = None
    language: str | None = None
    metadata: dict[str, Any] | None = None


class ArtifactResponse(BaseModel):
    id: str
    project_id: str
    type: str
    title: str
    content: str
    language: str | None
    status: str
    reviewed_since_change: bool
    created_at: datetime
    updated_at: datetime
    slot: Slot | None = None
    metadata: dict[str, Any] | None = Field(default=None, validation_alias="metadata_")

    model_config = {"from_attributes": True}


class ApproveRequest(BaseModel):
    """`force` is the "Approve anyway" path when no review ran since the last change."""

    force: bool = False
    session_id: str | None = None


class ApproveResponse(ArtifactResponse):
    """The approved artifact plus the message written into the active chat (if any)."""

    chat_message: MessageResponse | None = None


class ApprovedVersionResponse(BaseModel):
    """Last approved copy of an artifact."""

    model_config = ConfigDict(from_attributes=True)

    artifact_id: str
    version_no: int
    content: str
    created_at: datetime
