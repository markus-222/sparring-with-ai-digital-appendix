"""Workshop question list: oldest first, owner-scoped. DB-backed, no LLM."""

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.user import User
from app.models.workshop_question import WorkshopQuestion


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])


@pytest.mark.asyncio
async def test_empty_project_has_no_questions(client: AsyncClient) -> None:
    project_id = await _project(client)

    response = await client.get(f"/api/v1/projects/{project_id}/workshop-questions")

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_questions_are_listed_oldest_first(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    # Explicit timestamps: server defaults are all equal inside the test transaction.
    db_session.add(
        WorkshopQuestion(
            project_id=project_id,
            text="Second?",
            created_at=datetime(2026, 10, 4, 12, 0, tzinfo=UTC),
        )
    )
    db_session.add(
        WorkshopQuestion(
            project_id=project_id,
            text="First?",
            created_at=datetime(2026, 10, 4, 11, 0, tzinfo=UTC),
        )
    )
    await db_session.flush()

    response = await client.get(f"/api/v1/projects/{project_id}/workshop-questions")

    assert response.status_code == 200
    body = response.json()
    assert [q["text"] for q in body] == ["First?", "Second?"]
    assert set(body[0]) == {
        "id",
        "text",
        "origin_artifact_id",
        "origin_comment_id",
        "created_at",
    }


@pytest.mark.asyncio
async def test_another_users_project_is_404(client: AsyncClient, db_session: AsyncSession) -> None:
    user_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
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

    response = await client.get(f"/api/v1/projects/{project_id}/workshop-questions")

    assert response.status_code == 404
