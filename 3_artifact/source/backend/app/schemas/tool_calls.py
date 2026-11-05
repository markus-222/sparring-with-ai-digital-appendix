"""Record of one assistant turn (messages.tool_calls JSON): calls, LLM transcript, asked slots."""

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.run import Slot


class ToolCallRecord(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    ok: bool


class ToolCallsRecord(BaseModel):
    calls: list[ToolCallRecord] = Field(default_factory=list)
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    asked_slots: list[Slot] = Field(default_factory=list)


def turn_record(
    calls: list[ToolCallRecord], transcript: list[dict[str, Any]], asked_slots: list[Slot]
) -> dict[str, Any] | None:
    """Shape a finished turn for the JSON column; None when there is nothing to store."""
    if not (calls or transcript or asked_slots):
        return None
    record = ToolCallsRecord(calls=calls, transcript=transcript, asked_slots=asked_slots)
    return record.model_dump(mode="json")


def read_turn_record(stored: dict[str, Any] | None) -> ToolCallsRecord:
    """Old rows only hold `calls`; a missing row reads as an empty record."""
    return ToolCallsRecord() if stored is None else ToolCallsRecord.model_validate(stored)
