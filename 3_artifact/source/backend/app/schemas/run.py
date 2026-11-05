"""Run schemas: API edge for background runs."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Slot = Literal["01", "02", "03"]
RunType = Literal["draft", "review"]
RunState = Literal["running", "succeeded", "failed"]


class RunCreate(BaseModel):
    type: RunType
    slot: Slot


class RunResponse(BaseModel):
    id: str
    project_id: str
    type: RunType
    slot: Slot
    state: RunState
    step: str | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}
