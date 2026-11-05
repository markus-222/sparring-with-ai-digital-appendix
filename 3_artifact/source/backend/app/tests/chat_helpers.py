"""Shared helpers for the chat service and chat API tests."""

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.llm import LLMResponse
from app.models.session import Session
from app.schemas.chat import ChatEvent, ChatRequest, DoneEvent
from app.services.chat_service import ChatService


def _raw_call(call_id: str, name: str, args: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


def tool_call(name: str, call_id: str = "c1", **args: Any) -> LLMResponse:
    """A scripted model response that only calls one tool."""
    return LLMResponse(content="", tool_calls=[_raw_call(call_id, name, args)])


def tool_calls(*pairs: tuple[str, dict[str, Any]]) -> LLMResponse:
    """A scripted model response that calls several tools: (name, arguments), ids c1, c2, ..."""
    calls = [_raw_call(f"c{index}", name, args) for index, (name, args) in enumerate(pairs, 1)]
    return LLMResponse(content="", tool_calls=calls)


def make_request(session_id: str, message: str, **kwargs: Any) -> ChatRequest:
    return ChatRequest(session_id=session_id, message=message, **kwargs)


async def collect(
    service: ChatService, db: AsyncSession, session: Session, request: ChatRequest
) -> list[ChatEvent]:
    return [event async for event in service.stream(db, session, request)]


def done_event(events: list[ChatEvent]) -> DoneEvent:
    dones = [data for name, data in events if name == "done" and isinstance(data, DoneEvent)]
    assert len(dones) == 1
    return dones[0]


def parse_sse(text: str) -> list[tuple[str, str]]:
    parsed: list[tuple[str, str]] = []
    for block in text.split("\n\n"):
        name = ""
        data = ""
        for line in block.splitlines():
            if line.startswith("event: "):
                name = line[len("event: ") :]
            elif line.startswith("data: "):
                data = line[len("data: ") :]
        if name:
            parsed.append((name, data))
    return parsed
