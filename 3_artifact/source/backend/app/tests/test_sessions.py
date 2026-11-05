"""Tests for session CRUD and cross-tenant isolation."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession as DbSession

from app.models.message import Message
from app.models.project import Project
from app.models.session import Session
from app.models.user import User
from app.services.approval_service import approve_artifact
from app.services.chat_events import record_event
from app.services.chat_texts import GREETING_NEW
from app.services.draft_run import store_draft
from app.services.slot_service import get_slot_artifact


async def _make_project(client: AsyncClient) -> str:
    resp = await client.post("/api/v1/projects", json={"name": "Test", "description": None})
    assert resp.status_code == 201
    return resp.json()["id"]  # type: ignore[no-any-return]


async def _make_foreign_session(db: DbSession) -> tuple[str, str]:
    """Create a second user + project + session directly via the DB
    (bypassing the API, which always authenticates as the fixture user)."""
    user_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    db.add(
        User(
            id=user_id,
            username=f"foreign-{user_id}@example.invalid",
            hashed_password="hashed",
            display_name="Foreign User",
        )
    )
    db.add(Project(id=project_id, name="Foreign Project", owner_id=user_id))
    db.add(Session(id=session_id, project_id=project_id, title="Foreign Session"))
    await db.commit()
    return project_id, session_id


@pytest.mark.integration
async def test_create_session(client: AsyncClient) -> None:
    project_id = await _make_project(client)
    resp = await client.post(
        "/api/v1/sessions",
        json={"project_id": project_id, "title": "My Session"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["project_id"] == project_id
    assert data["title"] == "My Session"


@pytest.mark.integration
async def test_session_response_has_no_chat_type(client: AsyncClient) -> None:
    project_id = await _make_project(client)

    resp = await client.post("/api/v1/sessions", json={"project_id": project_id})

    assert resp.status_code == 201
    body = resp.json()
    assert "chat_type" not in body
    assert "reviewed_artifact" not in body


@pytest.mark.integration
async def test_create_session_404_for_foreign_project(
    client: AsyncClient, db_session: DbSession
) -> None:
    """Creating a session under a project you don't own must 404, not succeed."""
    foreign_project_id, _ = await _make_foreign_session(db_session)
    resp = await client.post(
        "/api/v1/sessions",
        json={"project_id": foreign_project_id, "title": "Hijack"},
    )
    assert resp.status_code == 404


@pytest.mark.integration
async def test_get_session_returns_message_history(client: AsyncClient) -> None:
    project_id = await _make_project(client)
    create_resp = await client.post("/api/v1/sessions", json={"project_id": project_id})
    session_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/sessions/{session_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == session_id
    assert [m["role"] for m in data["messages"]] == ["assistant"]


@pytest.mark.integration
async def test_list_sessions_by_project(client: AsyncClient) -> None:
    project_id = await _make_project(client)
    await client.post("/api/v1/sessions", json={"project_id": project_id, "title": "A"})
    await client.post("/api/v1/sessions", json={"project_id": project_id, "title": "B"})

    resp = await client.get(f"/api/v1/sessions?project_id={project_id}")
    assert resp.status_code == 200
    titles = {s["title"] for s in resp.json()}
    assert titles == {"A", "B"}


@pytest.mark.integration
async def test_cross_tenant_session_routes_404(client: AsyncClient, db_session: DbSession) -> None:
    """GET on a session owned by another user's project must 404 – regression
    test for the sessions.py IDOR where ownership was never checked, only
    session existence."""
    _, foreign_session_id = await _make_foreign_session(db_session)

    get_resp = await client.get(f"/api/v1/sessions/{foreign_session_id}")
    assert get_resp.status_code == 404


@pytest.mark.integration
async def test_list_sessions_excludes_other_users_sessions(
    client: AsyncClient, db_session: DbSession
) -> None:
    """GET /sessions without project_id must scope to the caller's own
    projects – omitting the filter used to return every user's sessions."""
    _, foreign_session_id = await _make_foreign_session(db_session)
    project_id = await _make_project(client)
    own_resp = await client.post("/api/v1/sessions", json={"project_id": project_id})
    own_session_id = own_resp.json()["id"]

    resp = await client.get("/api/v1/sessions")
    assert resp.status_code == 200
    ids = {s["id"] for s in resp.json()}
    assert own_session_id in ids
    assert foreign_session_id not in ids


@pytest.mark.integration
async def test_session_detail_hides_system_events(
    client: AsyncClient, db_session: DbSession
) -> None:
    project_id = await _make_project(client)
    created = await client.post("/api/v1/sessions", json={"project_id": project_id})
    session_id = created.json()["id"]
    db_session.add(
        Message(
            session_id=session_id,
            role="user",
            content="hello",
            created_at=datetime.now(UTC) + timedelta(minutes=1),
        )
    )
    await db_session.flush()
    await record_event(db_session, project_id, "Artifact 01 approved.")

    resp = await client.get(f"/api/v1/sessions/{session_id}")

    assert resp.status_code == 200
    messages = resp.json()["messages"]
    assert [m["role"] for m in messages] == ["assistant", "user"]
    assert messages[1]["content"] == "hello"


@pytest.mark.integration
async def test_new_session_starts_with_the_greeting(
    client: AsyncClient, db_session: DbSession
) -> None:
    project_id = await _make_project(client)
    created = await client.post("/api/v1/sessions", json={"project_id": project_id})
    session_id = created.json()["id"]

    resp = await client.get(f"/api/v1/sessions/{session_id}")

    messages = resp.json()["messages"]
    assert len(messages) == 1
    assert messages[0]["role"] == "assistant"
    assert messages[0]["agent_name"] == "analyst"
    assert messages[0]["content"] == GREETING_NEW


@pytest.mark.integration
async def test_greeting_names_the_next_step_after_an_approval(
    client: AsyncClient, db_session: DbSession
) -> None:
    project_id = await _make_project(client)
    await store_draft(db_session, project_id, "01", "## Problem\nOffers take long.\n")
    artifact = await get_slot_artifact(db_session, project_id, "01")
    await approve_artifact(db_session, artifact, force=True)

    created = await client.post("/api/v1/sessions", json={"project_id": project_id})
    resp = await client.get(f"/api/v1/sessions/{created.json()['id']}")

    messages = resp.json()["messages"]
    assert [m["content"] for m in messages] == [
        "Willkommen zurück. Als Nächstes folgt die Stakeholder-Analyse."
    ]


@pytest.mark.integration
async def test_each_session_has_its_own_messages(
    client: AsyncClient, db_session: DbSession
) -> None:
    project_id = await _make_project(client)
    first = (await client.post("/api/v1/sessions", json={"project_id": project_id})).json()["id"]
    db_session.add(
        Message(
            session_id=first,
            role="user",
            content="only in the first chat",
            created_at=datetime.now(UTC) + timedelta(minutes=1),
        )
    )
    await db_session.flush()
    second = (await client.post("/api/v1/sessions", json={"project_id": project_id})).json()["id"]

    first_messages = (await client.get(f"/api/v1/sessions/{first}")).json()["messages"]
    second_messages = (await client.get(f"/api/v1/sessions/{second}")).json()["messages"]

    assert [m["role"] for m in first_messages] == ["assistant", "user"]
    assert [m["role"] for m in second_messages] == ["assistant"]
