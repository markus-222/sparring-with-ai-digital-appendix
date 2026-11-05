"""Review needs a non-empty draft with no open comments."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.comment import Comment
from app.services.draft_run import store_draft
from app.services.run_preconditions import RunPreconditionError, check_run_preconditions
from app.services.slot_service import get_slot_artifact


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])


@pytest.mark.asyncio
async def test_draft_run_has_no_precondition(client: AsyncClient, db_session: AsyncSession) -> None:
    project_id = await _project(client)

    await check_run_preconditions(db_session, project_id, "draft", "01")


@pytest.mark.asyncio
async def test_review_of_a_not_started_artifact_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)

    with pytest.raises(RunPreconditionError) as info:
        await check_run_preconditions(db_session, project_id, "review", "01")

    assert info.value.code == "not_draft"


@pytest.mark.asyncio
async def test_review_of_an_empty_draft_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    await store_draft(db_session, project_id, "01", "   ")

    with pytest.raises(RunPreconditionError) as info:
        await check_run_preconditions(db_session, project_id, "review", "01")

    assert info.value.code == "empty_draft"


@pytest.mark.asyncio
async def test_review_with_open_comments_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    await store_draft(db_session, project_id, "01", "## Problem\nText")
    artifact = await get_slot_artifact(db_session, project_id, "01")
    db_session.add(
        Comment(
            artifact_id=artifact.id,
            number=1,
            review_number=1,
            title="t",
            description="d",
            sources=[],
            status="open",
        )
    )
    await db_session.flush()

    with pytest.raises(RunPreconditionError) as info:
        await check_run_preconditions(db_session, project_id, "review", "01")

    assert info.value.code == "open_comments"


@pytest.mark.asyncio
async def test_review_of_a_clean_draft_is_allowed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    await store_draft(db_session, project_id, "01", "## Problem\nText")

    await check_run_preconditions(db_session, project_id, "review", "01")
