"""The runs table is the project lock: one running run per project."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.run import Run
from app.schemas.run import RunResponse


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "R"})).json()["id"])


def _run(project_id: str, state: str = "running", slot: str = "01") -> Run:
    return Run(id=str(uuid.uuid4()), project_id=project_id, type="draft", slot=slot, state=state)


@pytest.mark.asyncio
async def test_second_running_run_for_a_project_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    db_session.add(_run(project_id))
    await db_session.flush()

    with pytest.raises(IntegrityError, match="uq_runs_one_running_per_project"):
        async with db_session.begin_nested():
            db_session.add(_run(project_id, slot="02"))
            await db_session.flush()


@pytest.mark.asyncio
async def test_finished_runs_do_not_block_a_new_run(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    db_session.add_all(
        [_run(project_id, "failed"), _run(project_id, "succeeded"), _run(project_id, "running")]
    )

    await db_session.flush()


@pytest.mark.asyncio
async def test_two_projects_can_run_in_parallel(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    first, second = await _project(client), await _project(client)
    db_session.add_all([_run(first), _run(second)])

    await db_session.flush()


@pytest.mark.asyncio
async def test_invalid_state_violates_check_constraint(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)

    with pytest.raises(IntegrityError, match="ck_runs_state"):
        async with db_session.begin_nested():
            db_session.add(_run(project_id, "paused"))
            await db_session.flush()


@pytest.mark.asyncio
async def test_deleting_the_project_deletes_its_runs(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    db_session.add(_run(project_id, "failed"))
    await db_session.flush()

    project = (
        await db_session.execute(select(Project).where(Project.id == project_id))
    ).scalar_one()
    await db_session.delete(project)
    await db_session.flush()

    count = (await db_session.execute(select(func.count()).select_from(Run))).scalar_one()
    assert count == 0


@pytest.mark.asyncio
async def test_run_response_reads_a_persisted_run(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    run = _run(project_id)
    db_session.add(run)
    await db_session.flush()
    await db_session.refresh(run)

    response = RunResponse.model_validate(run)

    assert (response.type, response.slot, response.state) == ("draft", "01", "running")
    assert response.step is None and response.finished_at is None
