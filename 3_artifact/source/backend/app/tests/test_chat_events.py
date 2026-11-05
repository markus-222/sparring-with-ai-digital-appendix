"""Chat events: system messages written into the project's latest session."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.message import Message
from app.models.session import Session
from app.schemas.run import Slot
from app.services.chat_events import list_recent_events, record_event
from app.services.draft_run import store_draft
from app.services.slot_service import get_slot_artifact


async def _project_with_session(client: AsyncClient) -> tuple[str, str]:
    project_id = (await client.post("/api/v1/projects", json={"name": "P"})).json()["id"]
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id, "title": None})
    return str(project_id), str(resp.json()["id"])


@pytest.mark.asyncio
async def test_event_lands_in_latest_session_and_is_listed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    await record_event(db_session, project_id, "Artifact 01 approved.")
    assert await list_recent_events(db_session, session_id) == ["Artifact 01 approved."]
    rows = await db_session.execute(
        select(Message).where(Message.session_id == session_id, Message.role == "system")
    )
    message = rows.scalar_one()
    assert message.agent_name == "event"


@pytest.mark.asyncio
async def test_event_goes_to_newest_session(client: AsyncClient, db_session: AsyncSession) -> None:
    project_id, old_session_id = await _project_with_session(client)
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id, "title": None})
    new_session_id = str(resp.json()["id"])
    old_row = await db_session.get(Session, old_session_id)
    assert old_row is not None
    old_row.created_at = datetime.now(UTC) - timedelta(hours=1)
    await db_session.flush()
    await record_event(db_session, project_id, "Artifact 02 approved.")
    assert await list_recent_events(db_session, new_session_id) == ["Artifact 02 approved."]
    assert await list_recent_events(db_session, old_session_id) == []


@pytest.mark.asyncio
async def test_event_without_session_is_a_noop(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = (await client.post("/api/v1/projects", json={"name": "P"})).json()["id"]
    await record_event(db_session, project_id, "x")
    assert (await db_session.execute(select(Message))).scalars().all() == []


@pytest.mark.asyncio
async def test_events_are_limited_and_ordered_oldest_first(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    for index in range(7):
        await record_event(db_session, project_id, f"e{index}")
    assert await list_recent_events(db_session, session_id, limit=3) == ["e4", "e5", "e6"]


@pytest.mark.asyncio
async def test_list_recent_events_ignores_chat_messages(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    db_session.add(Message(session_id=session_id, role="user", content="hello"))
    await db_session.flush()
    await record_event(db_session, project_id, "Artifact 01 approved.")
    assert await list_recent_events(db_session, session_id) == ["Artifact 01 approved."]


CONTENT = "## Problem\nOffers take long.\n"
TEXT_CHANGE: dict[str, Any] = {
    "kind": "text_change",
    "find": "Offers take long.",
    "replace": "Offers take 3 days.",
}


async def _draft(db_session: AsyncSession, project_id: str, slot: Slot = "01") -> Artifact:
    await store_draft(db_session, project_id, slot, CONTENT)
    return await get_slot_artifact(db_session, project_id, slot)


async def _comment(db_session: AsyncSession, artifact: Artifact, find: str) -> Comment:
    comment = Comment(
        artifact_id=artifact.id,
        number=1,
        review_number=1,
        title="Unclear scope",
        description="The scope is vague.",
        sources=[],
        status="open",
        role="reviewer",
        suggestion={**TEXT_CHANGE, "find": find},
    )
    db_session.add(comment)
    await db_session.flush()
    return comment


@pytest.mark.asyncio
async def test_approve_endpoint_writes_an_event_into_the_newest_session(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id)

    resp = await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    assert resp.status_code == 200
    assert await list_recent_events(db_session, session_id) == ["Artifact 01 approved."]


@pytest.mark.asyncio
async def test_a_refused_approval_writes_no_event(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id)

    resp = await client.post(f"/api/v1/artifacts/{artifact.id}/approve")

    assert resp.status_code == 409
    assert await list_recent_events(db_session, session_id) == []


@pytest.mark.asyncio
async def test_event_uses_the_slot_of_the_artifact(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id, "02")

    await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    assert await list_recent_events(db_session, session_id) == ["Artifact 02 approved."]


@pytest.mark.asyncio
async def test_manual_content_change_writes_a_saved_event(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id)

    resp = await client.put(
        f"/api/v1/artifacts/{artifact.id}", json={"content": "## Problem\nChanged.\n"}
    )

    assert resp.status_code == 200
    assert await list_recent_events(db_session, session_id) == ["Artifact 01 saved by the user."]


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{"title": "Renamed"}, {"content": CONTENT}, {}])
async def test_save_without_a_content_change_writes_no_event(
    client: AsyncClient, db_session: AsyncSession, body: dict[str, str]
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id)

    resp = await client.put(f"/api/v1/artifacts/{artifact.id}", json=body)

    assert resp.status_code == 200
    assert await list_recent_events(db_session, session_id) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("action", "body", "status"),
    [
        ("accept", None, "accepted"),
        ("edit", {"suggestion": {**TEXT_CHANGE, "replace": "Offers take 2 days."}}, "edited"),
        ("reject", {"reason": "not needed"}, "rejected"),
        ("done-manually", None, "done_manually"),
    ],
)
async def test_each_resolving_comment_action_writes_an_event(
    client: AsyncClient,
    db_session: AsyncSession,
    action: str,
    body: dict[str, Any] | None,
    status: str,
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id)
    comment = await _comment(db_session, artifact, TEXT_CHANGE["find"])
    url = f"/api/v1/comments/{comment.id}/{action}"

    resp = await client.post(url, json=body) if body is not None else await client.post(url)

    assert resp.status_code == 200
    assert await list_recent_events(db_session, session_id) == [
        f"Comment 'Unclear scope' resolved ({status})."
    ]


@pytest.mark.asyncio
async def test_a_comment_that_stays_open_writes_no_event(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id)
    comment = await _comment(db_session, artifact, "text that is not in the artifact")

    resp = await client.post(f"/api/v1/comments/{comment.id}/accept")

    assert resp.status_code == 200
    assert resp.json()["outcome"] == "not_located"
    assert await list_recent_events(db_session, session_id) == []
