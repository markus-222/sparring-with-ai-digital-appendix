"""POST /api/v1/chat/stream: SSE framing, ownership and validation. LLM faked."""

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.fake_llm import FakeLLM
from app.infra.llm import LLMUnavailableError
from app.models.message import Message
from app.models.project import Project
from app.models.session import Session
from app.models.user import User
from app.services.chat_toolbox import ChatToolbox
from app.services.draft_run import store_draft
from app.services.slot_service import ensure_slots, get_slot_artifact
from app.tests.chat_helpers import parse_sse, tool_call


async def _own_session_id(client: AsyncClient) -> str:
    project_id = str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id, "title": None})
    return str(resp.json()["id"])


async def _foreign_session_id(db_session: AsyncSession) -> str:
    user_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    db_session.add(
        User(
            id=user_id,
            username=f"foreign-{user_id}@example.invalid",
            hashed_password="hashed",
            display_name="Foreign User",
        )
    )
    db_session.add(Project(id=project_id, name="Foreign Project", owner_id=user_id))
    db_session.add(Session(id=session_id, project_id=project_id, title="Foreign Session"))
    await db_session.flush()
    return session_id


@pytest.mark.asyncio
async def test_stream_answers_with_sse_events_and_a_done_event(
    client: AsyncClient, fake_llm: FakeLLM
) -> None:
    session_id = await _own_session_id(client)
    fake_llm.enqueue("The goal is X.")

    resp = await client.post(
        "/api/v1/chat/stream", json={"session_id": session_id, "message": "What is the goal?"}
    )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert resp.headers["cache-control"] == "no-cache"
    assert "event: done" in resp.text
    events = parse_sse(resp.text)
    names = [name for name, _ in events]
    assert set(names[:-1]) == {"token"}
    assert names[-1] == "done"
    assert "".join(json.loads(data) for name, data in events if name == "token") == "The goal is X."
    done = json.loads(events[-1][1])
    message_id = done.pop("message_id")
    assert isinstance(message_id, str)
    assert done == {
        "content": "The goal is X.",
        "agent": "analyst",
        "label": "Analyst",
        "pending": False,
        "proposal": None,
    }


@pytest.mark.asyncio
async def test_stream_of_a_foreign_session_is_404(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM
) -> None:
    foreign_id = await _foreign_session_id(db_session)

    resp = await client.post(
        "/api/v1/chat/stream", json={"session_id": foreign_id, "message": "Hello"}
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Session not found"
    assert fake_llm.requests == []


@pytest.mark.asyncio
async def test_stream_of_an_unknown_session_is_404(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/chat/stream", json={"session_id": str(uuid.uuid4()), "message": "Hello"}
    )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_empty_message_is_422(client: AsyncClient) -> None:
    session_id = await _own_session_id(client)

    resp = await client.post("/api/v1/chat/stream", json={"session_id": session_id, "message": ""})

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_too_long_message_is_422(client: AsyncClient) -> None:
    session_id = await _own_session_id(client)

    resp = await client.post(
        "/api/v1/chat/stream", json={"session_id": session_id, "message": "x" * 8001}
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_llm_failure_is_an_error_event_without_exception_text(
    client: AsyncClient, fake_llm: FakeLLM
) -> None:
    session_id = await _own_session_id(client)
    fake_llm.enqueue(LLMUnavailableError("secret upstream detail"))

    resp = await client.post(
        "/api/v1/chat/stream", json={"session_id": session_id, "message": "Hello"}
    )

    assert resp.status_code == 200
    events = parse_sse(resp.text)
    assert [name for name, _ in events] == ["error"]
    assert json.loads(events[0][1]) == {"message": "LLM call failed"}
    assert "secret upstream detail" not in resp.text


async def _message_count(db: AsyncSession, session_id: str) -> int:
    count = await db.scalar(
        select(func.count()).select_from(Message).where(Message.session_id == session_id)
    )
    return int(count or 0)


@pytest.mark.asyncio
async def test_a_failing_tool_handler_leaves_no_half_turn_behind(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_llm: FakeLLM,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_id = await _own_session_id(client)
    session = await db_session.get(Session, session_id)
    assert session is not None
    await ensure_slots(db_session, session.project_id)
    await store_draft(db_session, session.project_id, "01", "## Problem\nOffers take long.\n")
    artifact = await get_slot_artifact(db_session, session.project_id, "01")
    await db_session.commit()
    before = await _message_count(db_session, session_id)

    def fail(self: ChatToolbox, artifact_id: str) -> None:
        raise RuntimeError("handler bug")

    monkeypatch.setattr(ChatToolbox, "_show", fail)
    fake_llm.enqueue(
        tool_call("edit_artifact", slot="01", find="take long", replace="take 3 days"), "Done."
    )

    resp = await client.post(
        "/api/v1/chat/stream", json={"session_id": session_id, "message": "Change the text"}
    )

    events = parse_sse(resp.text)
    assert [name for name, _ in events] == ["status", "error"]
    assert json.loads(events[-1][1]) == {"message": "Internal error"}
    assert await _message_count(db_session, session_id) == before
    await db_session.refresh(artifact)
    assert artifact.content == "## Problem\nOffers take long.\n"
