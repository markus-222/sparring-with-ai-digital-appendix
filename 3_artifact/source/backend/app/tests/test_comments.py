"""Comment API: list and the four resolving actions. DB-backed, no LLM."""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.project import Project
from app.models.run import Run
from app.models.user import User
from app.services.draft_run import store_draft
from app.services.slot_service import get_slot_artifact

TEXT: dict[str, Any] = {
    "kind": "text_change",
    "find": "Offers take long.",
    "replace": "Offers take 3 days.",
}
QUESTION: dict[str, Any] = {"kind": "workshop_question", "text": "What is the target?"}
CONTENT = "## Problem\nOffers take long.\n"
ACTIONS = ("accept", "edit", "reject", "done-manually")
EDIT_BODY: dict[str, Any] = {
    "suggestion": {
        "kind": "text_change",
        "find": "Offers take long.",
        "replace": "Offers take 2 days.",
    }
}


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])


async def _setup(
    client: AsyncClient, db_session: AsyncSession, content: str = CONTENT
) -> tuple[str, Artifact]:
    project_id = await _project(client)
    await store_draft(db_session, project_id, "01", content)
    return project_id, await get_slot_artifact(db_session, project_id, "01")


async def _comment(
    db_session: AsyncSession,
    artifact: Artifact,
    suggestion: dict[str, Any] | None,
    *,
    number: int = 1,
    role: str = "reviewer",
    hypothesis: bool = False,
    status: str = "open",
) -> Comment:
    comment = Comment(
        artifact_id=artifact.id,
        number=number,
        review_number=1,
        title=f"T{number}",
        description="D",
        sources=[],
        status=status,
        role=role,
        hypothesis=hypothesis,
        suggestion=suggestion,
    )
    db_session.add(comment)
    await db_session.flush()
    return comment


async def _foreign_comment(db_session: AsyncSession) -> tuple[str, str]:
    """A comment on an artifact of another user's project: (artifact id, comment id)."""
    user_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    artifact_id = str(uuid.uuid4())
    db_session.add(
        User(
            id=user_id,
            username=f"foreign-{user_id}@example.invalid",
            hashed_password="hashed",
            display_name="Foreign User",
        )
    )
    db_session.add(Project(id=project_id, name="x", owner_id=user_id))
    await db_session.flush()
    artifact = Artifact(
        id=artifact_id,
        project_id=project_id,
        type="risk",
        title="Foreign Artifact",
        content=CONTENT,
        status="draft",
    )
    db_session.add(artifact)
    await db_session.flush()
    comment = await _comment(db_session, artifact, TEXT)
    return artifact_id, comment.id


async def _list(client: AsyncClient, artifact_id: str) -> list[dict[str, Any]]:
    response = await client.get(f"/api/v1/comments?artifact_id={artifact_id}")
    assert response.status_code == 200
    body: list[dict[str, Any]] = response.json()
    return body


async def _post(
    client: AsyncClient, comment_id: str, action: str, body: dict[str, Any] | None = None
) -> Any:
    url = f"/api/v1/comments/{comment_id}/{action}"
    return await client.post(url, json=body) if body is not None else await client.post(url)


@pytest.mark.asyncio
async def test_list_returns_comments_ordered_by_number_with_new_fields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    await _comment(db_session, artifact, QUESTION, number=2, role="explorer", hypothesis=True)
    await _comment(db_session, artifact, TEXT, number=1)

    comments = await _list(client, artifact.id)

    assert [c["number"] for c in comments] == [1, 2]
    assert [c["role"] for c in comments] == ["reviewer", "explorer"]
    assert [c["hypothesis"] for c in comments] == [False, True]
    assert [c["suggestion"]["kind"] for c in comments] == ["text_change", "workshop_question"]
    assert [c["status"] for c in comments] == ["open", "open"]


@pytest.mark.asyncio
async def test_list_of_another_users_artifact_is_empty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    artifact_id, _ = await _foreign_comment(db_session)

    assert await _list(client, artifact_id) == []


@pytest.mark.asyncio
async def test_accept_applies_text_change_and_changes_the_artifact(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    response = await _post(client, comment.id, "accept")

    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] == "applied"
    assert body["comment"]["status"] == "accepted"
    shown = await client.get(f"/api/v1/artifacts/{artifact.id}")
    assert "Offers take 3 days." in shown.json()["content"]
    assert "Offers take long." not in shown.json()["content"]


@pytest.mark.asyncio
async def test_accept_workshop_question_lists_it_on_the_project(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, QUESTION)

    response = await _post(client, comment.id, "accept")

    assert response.status_code == 200
    assert response.json()["outcome"] == "question_added"
    listed = await client.get(f"/api/v1/projects/{project_id}/workshop-questions")
    assert listed.status_code == 200
    (question,) = listed.json()
    assert question["text"] == "What is the target?"
    assert question["origin_comment_id"] == comment.id
    assert question["origin_artifact_id"] == artifact.id


@pytest.mark.asyncio
async def test_edit_applies_the_edited_suggestion(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    response = await _post(client, comment.id, "edit", EDIT_BODY)

    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] == "applied"
    assert body["comment"]["status"] == "edited"
    assert body["comment"]["suggestion"]["replace"] == "Offers take 2 days."
    shown = await client.get(f"/api/v1/artifacts/{artifact.id}")
    assert "Offers take 2 days." in shown.json()["content"]


@pytest.mark.asyncio
async def test_edit_with_the_other_kind_is_409_wrong_edit_kind(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    response = await _post(client, comment.id, "edit", {"suggestion": QUESTION})

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "wrong_edit_kind"
    assert (await _list(client, artifact.id))[0]["status"] == "open"


@pytest.mark.asyncio
async def test_edit_with_an_unknown_kind_is_422(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    response = await _post(client, comment.id, "edit", {"suggestion": {"kind": "bogus"}})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_reject(client: AsyncClient, db_session: AsyncSession) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    response = await _post(client, comment.id, "reject")

    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] == "rejected"
    assert body["comment"]["status"] == "rejected"


@pytest.mark.asyncio
async def test_not_located_keeps_the_comment_open_until_done_manually(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact = await _setup(client, db_session)
    await store_draft(db_session, project_id, "01", "## Problem\nOther")
    comment = await _comment(db_session, artifact, TEXT)

    accepted = await _post(client, comment.id, "accept")

    assert accepted.status_code == 200
    assert accepted.json()["outcome"] == "not_located"
    assert accepted.json()["comment"]["status"] == "open"

    done = await _post(client, comment.id, "done-manually")

    assert done.status_code == 200
    assert done.json()["outcome"] == "done_manually"
    assert done.json()["comment"]["status"] == "done_manually"


@pytest.mark.asyncio
async def test_second_action_on_a_resolved_comment_is_409_not_open(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    accepted = await _comment(db_session, artifact, TEXT, number=1)
    other = await _comment(db_session, artifact, QUESTION, number=2)

    assert (await _post(client, accepted.id, "accept")).status_code == 200
    again = await _post(client, accepted.id, "accept")
    assert (await _post(client, other.id, "accept")).status_code == 200
    after_accept = await _post(client, other.id, "reject")

    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "not_open"
    assert after_accept.status_code == 409
    assert after_accept.json()["detail"]["code"] == "not_open"


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ACTIONS)
async def test_actions_are_409_run_active_while_a_run_is_running(
    client: AsyncClient, db_session: AsyncSession, action: str
) -> None:
    project_id, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)
    db_session.add(
        Run(id=str(uuid.uuid4()), project_id=project_id, type="draft", slot="01", state="running")
    )
    await db_session.flush()

    response = await _post(client, comment.id, action, EDIT_BODY if action == "edit" else None)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "run_active"
    assert (await _list(client, artifact.id))[0]["status"] == "open"


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ACTIONS)
async def test_actions_on_an_unknown_comment_are_404(client: AsyncClient, action: str) -> None:
    response = await _post(
        client, str(uuid.uuid4()), action, EDIT_BODY if action == "edit" else None
    )

    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ACTIONS)
async def test_actions_on_another_users_comment_are_404(
    client: AsyncClient, db_session: AsyncSession, action: str
) -> None:
    _, comment_id = await _foreign_comment(db_session)

    response = await _post(client, comment_id, action, EDIT_BODY if action == "edit" else None)

    assert response.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["resolve", "reopen"])
async def test_resolve_and_reopen_routes_are_gone(
    client: AsyncClient, db_session: AsyncSession, action: str
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    response = await _post(client, comment.id, action)

    assert response.status_code in (404, 405)
    assert (await _list(client, artifact.id))[0]["status"] == "open"
