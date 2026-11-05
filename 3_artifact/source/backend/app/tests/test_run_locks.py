"""While a run is active, artifact-changing endpoints answer 409."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.run import Run
from app.services.run_lock import ProjectLockedError, assert_project_unlocked, get_active_run


async def _setup(client: AsyncClient, db_session: AsyncSession) -> tuple[str, str]:
    """A project plus a reviewed free-type draft (so slot/approval rules do not interfere)."""
    project_id = str((await client.post("/api/v1/projects", json={"name": "L"})).json()["id"])
    legacy = Artifact(
        id=str(uuid.uuid4()),
        project_id=project_id,
        type="risk",
        title="Risk",
        content="text",
        status="draft",
        reviewed_since_change=True,
    )
    db_session.add(legacy)
    await db_session.flush()
    return project_id, legacy.id


def _run(project_id: str, state: str) -> Run:
    return Run(id=str(uuid.uuid4()), project_id=project_id, type="draft", slot="01", state=state)


def _locked(resp_json: dict[str, object]) -> bool:
    detail = resp_json["detail"]
    return isinstance(detail, dict) and detail.get("code") == "run_active"


@pytest.mark.asyncio
async def test_get_active_run_and_assert_unlocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, _ = await _setup(client, db_session)
    assert await get_active_run(db_session, project_id) is None
    await assert_project_unlocked(db_session, project_id)
    run = _run(project_id, "running")
    db_session.add(run)
    await db_session.flush()

    active = await get_active_run(db_session, project_id)

    assert active is not None and active.id == run.id
    with pytest.raises(ProjectLockedError) as info:
        await assert_project_unlocked(db_session, project_id)
    assert info.value.run_id == run.id


@pytest.mark.asyncio
async def test_update_is_locked_while_running(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact_id = await _setup(client, db_session)
    db_session.add(_run(project_id, "running"))
    await db_session.flush()

    resp = await client.put(f"/api/v1/artifacts/{artifact_id}", json={"content": "new"})

    assert resp.status_code == 409 and _locked(resp.json())


@pytest.mark.asyncio
async def test_approve_is_locked_while_running(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact_id = await _setup(client, db_session)
    db_session.add(_run(project_id, "running"))
    await db_session.flush()

    resp = await client.post(f"/api/v1/artifacts/{artifact_id}/approve")

    assert resp.status_code == 409 and _locked(resp.json())


@pytest.mark.asyncio
async def test_delete_is_locked_while_running(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact_id = await _setup(client, db_session)
    db_session.add(_run(project_id, "running"))
    await db_session.flush()

    resp = await client.delete(f"/api/v1/artifacts/{artifact_id}")

    assert resp.status_code == 409 and _locked(resp.json())


@pytest.mark.asyncio
async def test_reading_stays_possible_while_running(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact_id = await _setup(client, db_session)
    db_session.add(_run(project_id, "running"))
    await db_session.flush()

    listing = await client.get("/api/v1/artifacts", params={"project_id": project_id})
    single = await client.get(f"/api/v1/artifacts/{artifact_id}")

    assert listing.status_code == 200 and single.status_code == 200


@pytest.mark.asyncio
async def test_finished_run_does_not_lock(client: AsyncClient, db_session: AsyncSession) -> None:
    project_id, artifact_id = await _setup(client, db_session)
    db_session.add(_run(project_id, "failed"))
    await db_session.flush()

    resp = await client.put(f"/api/v1/artifacts/{artifact_id}", json={"content": "new"})

    assert resp.status_code == 200
