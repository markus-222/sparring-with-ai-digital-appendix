"""Approval message: a deterministic German message naming the next step."""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.services.approval_message import approval_text, write_approval_message
from app.services.slot_service import get_slot_artifact

NAME_01 = "01 Problem- and Scope-Definition"
NAME_02 = "02 Stakeholder Analysis"
NAME_03 = "03 Open Issues & Workshop Questions"


def test_approval_text_offers_a_draft_for_the_first_slot_not_started() -> None:
    text = approval_text("01", [("01", "approved"), ("02", "not_started"), ("03", "not_started")])

    assert text == (
        f"{NAME_01} ist freigegeben. Als Nächstes bietet sich {NAME_02} an. "
        "Soll ich einen Entwurf erstellen?"
    )


def test_approval_text_notes_an_existing_draft_of_the_next_slot() -> None:
    text = approval_text("01", [("01", "approved"), ("02", "draft"), ("03", "not_started")])

    assert text == (
        f"{NAME_01} ist freigegeben. Als Nächstes steht {NAME_02} an; "
        "der Entwurf dazu liegt bereits vor."
    )


def test_approval_text_when_all_three_are_approved() -> None:
    text = approval_text("03", [("01", "approved"), ("02", "approved"), ("03", "approved")])

    assert text == f"{NAME_03} ist freigegeben. Damit sind alle drei Artefakte freigegeben."


def test_approving_02_while_01_is_a_draft_names_01_next() -> None:
    text = approval_text("02", [("01", "draft"), ("02", "approved"), ("03", "not_started")])

    assert text == (
        f"{NAME_02} ist freigegeben. Als Nächstes steht {NAME_01} an; "
        "der Entwurf dazu liegt bereits vor."
    )


async def _project(client: AsyncClient) -> str:
    resp = await client.post("/api/v1/projects", json={"name": "P"})
    return str(resp.json()["id"])


async def _session(client: AsyncClient, project_id: str) -> str:
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id})
    return str(resp.json()["id"])


async def _approved_01(db: AsyncSession, project_id: str) -> Any:
    artifact = await get_slot_artifact(db, project_id, "01")
    artifact.status = "approved"
    artifact.content = "text"
    await db.flush()
    return artifact


async def _messages(db: AsyncSession, session_id: str) -> list[Message]:
    rows = await db.execute(select(Message).where(Message.session_id == session_id))
    return list(rows.scalars().all())


@pytest.mark.asyncio
async def test_no_session_writes_nothing(client: AsyncClient, db_session: AsyncSession) -> None:
    artifact = await _approved_01(db_session, await _project(client))

    assert await write_approval_message(db_session, artifact, None) is None


@pytest.mark.asyncio
async def test_unknown_session_writes_nothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    artifact = await _approved_01(db_session, await _project(client))

    assert await write_approval_message(db_session, artifact, "no-such-session") is None


@pytest.mark.asyncio
async def test_session_of_another_project_writes_nothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    artifact = await _approved_01(db_session, await _project(client))
    other_session = await _session(client, await _project(client))
    before = len(await _messages(db_session, other_session))

    assert await write_approval_message(db_session, artifact, other_session) is None
    assert len(await _messages(db_session, other_session)) == before


@pytest.mark.asyncio
async def test_valid_session_gets_the_message(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    session_id = await _session(client, project_id)
    artifact = await _approved_01(db_session, project_id)

    message = await write_approval_message(db_session, artifact, session_id)

    assert message is not None
    assert (message.role, message.agent_name, message.session_id) == (
        "assistant",
        "analyst",
        session_id,
    )
    assert message.content.startswith(f"{NAME_01} ist freigegeben. Als Nächstes bietet sich ")
    assert message in await _messages(db_session, session_id)


@pytest.mark.asyncio
async def test_approve_with_session_id_returns_and_stores_the_message(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    session_id = await _session(client, project_id)
    artifact = await get_slot_artifact(db_session, project_id, "01")
    artifact.status = "draft"
    artifact.content = "text"
    await db_session.flush()

    resp = await client.post(
        f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True, "session_id": session_id}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "approved"
    chat_message = body["chat_message"]
    assert chat_message["role"] == "assistant"
    assert chat_message["agent_name"] == "analyst"
    assert chat_message["content"].startswith(f"{NAME_01} ist freigegeben.")
    stored = [m.id for m in await _messages(db_session, session_id)]
    assert chat_message["id"] in stored


@pytest.mark.asyncio
async def test_approve_without_session_id_has_no_chat_message(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    artifact = await get_slot_artifact(db_session, project_id, "01")
    artifact.status = "draft"
    await db_session.flush()

    resp = await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    assert resp.status_code == 200
    assert resp.json()["chat_message"] is None


@pytest.mark.asyncio
async def test_failed_approval_writes_no_message(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    session_id = await _session(client, project_id)
    artifact = await get_slot_artifact(db_session, project_id, "01")
    artifact.status = "draft"
    await db_session.flush()
    before = len(await _messages(db_session, session_id))

    resp = await client.post(
        f"/api/v1/artifacts/{artifact.id}/approve", json={"session_id": session_id}
    )

    assert resp.status_code == 409
    assert len(await _messages(db_session, session_id)) == before
