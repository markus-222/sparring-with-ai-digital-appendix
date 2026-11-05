"""Tests for artifact reads, edits and the draft/approved lifecycle."""

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.project import Project
from app.models.session import Session
from app.models.user import User
from app.services.slot_service import SLOT_TYPES, get_slot_artifact


async def _create_project(client: AsyncClient, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"name": "Test", "description": None}
    payload.update(overrides)
    resp = await client.post("/api/v1/projects", json=payload)
    assert resp.status_code == 201
    return resp.json()  # type: ignore[no-any-return]


async def _create_session(client: AsyncClient, project_id: str) -> dict[str, Any]:
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id, "title": None})
    assert resp.status_code == 201
    return resp.json()  # type: ignore[no-any-return]


async def _create_artifact(
    db: AsyncSession,
    project_id: str,
    *,
    title: str = "Test Risk",
) -> Artifact:
    """Insert a free-type draft artifact directly (there is no create endpoint)."""
    artifact = Artifact(
        id=str(uuid.uuid4()),
        project_id=project_id,
        type="risk",
        title=title,
        content="This is a test risk artifact.",
        status="draft",
    )
    db.add(artifact)
    await db.flush()
    return artifact


async def _make_foreign_artifact(db: AsyncSession) -> str:
    """Create a second user + project + session + artifact directly via the
    DB (bypassing the API, which always authenticates as the fixture user).

    Used to assert that the fixture user's client cannot reach data owned by
    someone else (IDOR regression coverage)."""
    user_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    artifact_id = str(uuid.uuid4())
    db.add(
        User(
            id=user_id,
            username=f"foreign-{user_id}@example.invalid",
            hashed_password="hashed",
            display_name="Foreign User",
        )
    )
    db.add(Project(id=project_id, name="Foreign Project", owner_id=user_id))
    db.add(Session(id=session_id, project_id=project_id, title=None))
    db.add(
        Artifact(
            id=artifact_id,
            project_id=project_id,
            type="risk",
            title="Foreign Artifact",
            content="Belongs to another user.",
            status="draft",
        )
    )
    await db.commit()
    return artifact_id


@pytest.mark.integration
async def test_free_type_create_and_critic_review_routes_are_gone(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    artifact = await _create_artifact(db_session, project["id"])

    create = await client.post(
        "/api/v1/artifacts",
        json={"project_id": project["id"], "type": "risk", "title": "T", "content": "c"},
    )
    review = await client.post(f"/api/v1/artifacts/{artifact.id}/review-with-critic")

    assert create.status_code == 405
    assert review.status_code == 404


@pytest.mark.integration
async def test_list_artifacts_by_project(client: AsyncClient, db_session: AsyncSession) -> None:
    """GET /artifacts?project_id=... lists all artifacts of the project regardless of sessions."""
    project = await _create_project(client)
    await _create_session(client, project["id"])
    await _create_session(client, project["id"])
    await _create_artifact(db_session, project["id"], title="Artifact A")
    await _create_artifact(db_session, project["id"], title="Artifact B")

    resp = await client.get(f"/api/v1/artifacts?project_id={project['id']}")

    assert resp.status_code == 200
    body = resp.json()
    assert {a["title"] for a in body if a["type"] == "risk"} == {"Artifact A", "Artifact B"}
    assert {a["type"] for a in body} >= SLOT_TYPES


@pytest.mark.integration
async def test_approve_artifact_unconditional(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    artifact = await _create_artifact(db_session, project["id"])

    response = await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    assert response.status_code == 200
    assert response.json()["status"] == "approved"


@pytest.mark.integration
async def test_approve_artifact_already_approved_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    artifact = await _create_artifact(db_session, project["id"])
    await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    response = await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "not_draft"


@pytest.mark.integration
async def test_delete_artifact_works_from_draft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    artifact = await _create_artifact(db_session, project["id"])

    response = await client.delete(f"/api/v1/artifacts/{artifact.id}")

    assert response.status_code == 204


@pytest.mark.integration
async def test_delete_artifact_works_from_approved(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    artifact = await _create_artifact(db_session, project["id"])
    await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    response = await client.delete(f"/api/v1/artifacts/{artifact.id}")

    assert response.status_code == 204


@pytest.mark.integration
async def test_cross_tenant_artifact_routes_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Every artifact route must 404 (not leak/act) on an artifact owned by
    a different user's project – regression test for the artifacts.py IDOR
    where ownership was never checked, only artifact existence."""
    foreign_artifact_id = await _make_foreign_artifact(db_session)

    get_resp = await client.get(f"/api/v1/artifacts/{foreign_artifact_id}")
    assert get_resp.status_code == 404

    put_resp = await client.put(
        f"/api/v1/artifacts/{foreign_artifact_id}", json={"content": "Hijacked content"}
    )
    assert put_resp.status_code == 404

    approve_resp = await client.post(f"/api/v1/artifacts/{foreign_artifact_id}/approve")
    assert approve_resp.status_code == 404

    delete_resp = await client.delete(f"/api/v1/artifacts/{foreign_artifact_id}")
    assert delete_resp.status_code == 404


@pytest.mark.integration
async def test_list_artifacts_excludes_other_users_artifacts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """GET /artifacts without project_id must scope to the caller's own
    projects – omitting the filter used to return every user's artifacts."""
    foreign_artifact_id = await _make_foreign_artifact(db_session)
    project = await _create_project(client)
    own_artifact = await _create_artifact(db_session, project["id"])

    resp = await client.get("/api/v1/artifacts")
    assert resp.status_code == 200
    ids = {a["id"] for a in resp.json()}
    assert own_artifact.id in ids
    assert foreign_artifact_id not in ids


@pytest.mark.integration
async def test_slot_artifacts_expose_their_slot(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    await _create_artifact(db_session, project["id"])

    resp = await client.get(f"/api/v1/artifacts?project_id={project['id']}")

    assert resp.status_code == 200
    slots = {a["type"]: a["slot"] for a in resp.json()}
    assert slots["project_description"] == "01"
    assert slots["stakeholder_analysis"] == "02"
    assert slots["open_issues"] == "03"
    assert slots["risk"] is None


@pytest.mark.integration
async def test_download_returns_the_content_as_a_markdown_attachment(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    slot_01 = await get_slot_artifact(db_session, project["id"], "01")
    slot_01.status = "draft"
    slot_01.content = "# Äpfel\n\nText"
    await db_session.flush()

    resp = await client.get(f"/api/v1/artifacts/{slot_01.id}/download")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")
    assert (
        resp.headers["content-disposition"]
        == 'attachment; filename="01-problem-and-scope-definition.md"'
    )
    assert resp.content.decode("utf-8") == "# Äpfel\n\nText"


@pytest.mark.integration
async def test_download_of_a_not_started_artifact_is_409(client: AsyncClient) -> None:
    project = await _create_project(client)
    artifacts = (await client.get(f"/api/v1/artifacts?project_id={project['id']}")).json()

    resp = await client.get(f"/api/v1/artifacts/{artifacts[0]['id']}/download")

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "not_started"


@pytest.mark.integration
async def test_download_of_a_foreign_artifact_is_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    foreign_artifact_id = await _make_foreign_artifact(db_session)

    resp = await client.get(f"/api/v1/artifacts/{foreign_artifact_id}/download")

    assert resp.status_code == 404


@pytest.mark.integration
async def test_approved_version_404_for_never_approved_draft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    artifact = await _create_artifact(db_session, project["id"])

    resp = await client.get(f"/api/v1/artifacts/{artifact.id}/approved-version")

    assert resp.status_code == 404
    assert resp.json() == {"detail": "No approved version"}


@pytest.mark.integration
async def test_approved_version_returns_content_after_approval(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    artifact = await _create_artifact(db_session, project["id"])
    await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    resp = await client.get(f"/api/v1/artifacts/{artifact.id}/approved-version")

    assert resp.status_code == 200
    body = resp.json()
    assert body["artifact_id"] == artifact.id
    assert body["version_no"] == 1
    assert body["content"] == "This is a test risk artifact."
    assert body["created_at"]


@pytest.mark.integration
async def test_approved_version_survives_edit_back_to_draft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = await _create_project(client)
    artifact = await _create_artifact(db_session, project["id"])
    await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})
    put = await client.put(f"/api/v1/artifacts/{artifact.id}", json={"content": "edited text"})
    assert put.json()["status"] == "draft"

    resp = await client.get(f"/api/v1/artifacts/{artifact.id}/approved-version")

    assert resp.status_code == 200
    assert resp.json()["content"] == "This is a test risk artifact."
    assert resp.json()["version_no"] == 1


@pytest.mark.integration
async def test_approved_version_404_for_foreign_artifact(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    foreign_artifact_id = await _make_foreign_artifact(db_session)

    resp = await client.get(f"/api/v1/artifacts/{foreign_artifact_id}/approved-version")

    assert resp.status_code == 404
    assert resp.json() == {"detail": "Artifact not found"}
