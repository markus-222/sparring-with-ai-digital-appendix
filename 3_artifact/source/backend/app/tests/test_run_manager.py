"""RunManager: lock, failure semantics, timeout, recovery.

Test rule: between `start()` and `wait()` do not touch `db_session`/`client`
unless the worker is blocked on an asyncio.Event and does no DB work (one
asyncpg connection cannot run two operations at once).
"""

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.run import Run
from app.schemas.run import RunType
from app.services.run_manager import (
    RunContext,
    RunManager,
    RunStartError,
    RunWorker,
    SessionFactory,
)
from app.services.slot_service import get_slot_artifact


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "M"})).json()["id"])


async def _reload(db: AsyncSession, run_id: str) -> Run:
    result = await db.execute(
        select(Run).where(Run.id == run_id).execution_options(populate_existing=True)
    )
    return result.scalar_one()


def _blocked(release: asyncio.Event) -> RunWorker:
    async def worker(ctx: RunContext) -> None:
        await release.wait()

    return worker


@pytest.mark.asyncio
async def test_successful_run_records_step_and_finish(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    async def worker(ctx: RunContext) -> None:
        await ctx.set_step("writing")

    run_workers["draft"] = worker
    project_id = await _project(client)

    run = await run_manager.start(project_id, "draft", "01")
    assert (run.state, run.type, run.slot) == ("running", "draft", "01")
    assert run.created_at is not None
    await run_manager.wait(run.id)

    done = await _reload(db_session, run.id)
    assert (done.state, done.step, done.error) == ("succeeded", "writing", None)
    assert done.finished_at is not None


@pytest.mark.asyncio
async def test_worker_exception_fails_run_with_class_name_and_frees_lock(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    async def boom(ctx: RunContext) -> None:
        raise ValueError("secret payload that must not be stored")

    run_workers["draft"] = boom
    project_id = await _project(client)
    run = await run_manager.start(project_id, "draft", "01")
    await run_manager.wait(run.id)

    failed = await _reload(db_session, run.id)
    assert (failed.state, failed.error) == ("failed", "ValueError")
    again = await run_manager.start(project_id, "draft", "01")
    await run_manager.wait(again.id)


@pytest.mark.asyncio
async def test_failed_run_leaves_document_unchanged(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    async def half_done(ctx: RunContext) -> None:
        async with ctx.session() as db:
            artifact = await get_slot_artifact(db, ctx.project_id, ctx.slot)
            artifact.content = "half"
            await db.flush()
            raise RuntimeError("LLM failed after the write")

    run_workers["draft"] = half_done
    project_id = await _project(client)
    run = await run_manager.start(project_id, "draft", "01")
    await run_manager.wait(run.id)

    artifact = await get_slot_artifact(db_session, project_id, "01")
    await db_session.refresh(artifact)
    assert artifact.content == ""
    assert (await _reload(db_session, run.id)).state == "failed"


@pytest.mark.asyncio
async def test_session_commits_the_result_in_one_transaction(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    async def write(ctx: RunContext) -> None:
        async with ctx.session() as db:
            artifact = await get_slot_artifact(db, ctx.project_id, ctx.slot)
            artifact.content = "## Problem\nDone"
            artifact.status = "draft"

    run_workers["draft"] = write
    project_id = await _project(client)
    run = await run_manager.start(project_id, "draft", "01")
    await run_manager.wait(run.id)

    artifact = await get_slot_artifact(db_session, project_id, "01")
    await db_session.refresh(artifact)
    assert (artifact.status, artifact.content) == ("draft", "## Problem\nDone")


@pytest.mark.asyncio
async def test_second_start_for_same_project_is_rejected_while_running(
    client: AsyncClient,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    release = asyncio.Event()
    run_workers["draft"] = _blocked(release)
    run_workers["review"] = _blocked(release)
    project_id = await _project(client)
    first = await run_manager.start(project_id, "draft", "01")

    with pytest.raises(RunStartError) as info:
        await run_manager.start(project_id, "review", "02")

    assert info.value.code == "run_active"
    release.set()
    await run_manager.wait(first.id)


@pytest.mark.asyncio
async def test_different_projects_run_in_parallel(
    client: AsyncClient,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    first_release = asyncio.Event()
    second_release = asyncio.Event()
    first_project = await _project(client)
    second_project = await _project(client)
    releases = {first_project: first_release, second_project: second_release}

    async def worker(ctx: RunContext) -> None:
        await releases[ctx.project_id].wait()

    run_workers["draft"] = worker
    first = await run_manager.start(first_project, "draft", "01")
    second = await run_manager.start(second_project, "draft", "01")

    # Finish one after the other: the test connection is shared, so two
    # workers must not write at the same time.
    first_release.set()
    await run_manager.wait(first.id)
    second_release.set()
    await run_manager.wait(second.id)


@pytest.mark.asyncio
async def test_unregistered_run_type_is_not_available_and_creates_no_row(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id = await _project(client)

    with pytest.raises(RunStartError) as info:
        await run_manager.start(project_id, "review", "01")

    assert info.value.code == "not_available"
    rows = (await db_session.execute(select(Run).where(Run.project_id == project_id))).all()
    assert rows == []


@pytest.mark.asyncio
async def test_run_timeout_fails_with_timeout_code(
    client: AsyncClient,
    db_session: AsyncSession,
    session_factory: SessionFactory,
    run_workers: dict[RunType, RunWorker],
) -> None:
    async def slow(ctx: RunContext) -> None:
        await asyncio.sleep(30)

    run_workers["draft"] = slow
    manager = RunManager(session_factory, run_workers, timeout=0.05)
    project_id = await _project(client)

    run = await manager.start(project_id, "draft", "01")
    await manager.wait(run.id)

    failed = await _reload(db_session, run.id)
    assert (failed.state, failed.error) == ("failed", "timeout")


@pytest.mark.asyncio
async def test_shutdown_marks_running_runs_interrupted(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _blocked(asyncio.Event())
    project_id = await _project(client)
    run = await run_manager.start(project_id, "draft", "01")

    await run_manager.shutdown()

    stopped = await _reload(db_session, run.id)
    assert (stopped.state, stopped.error) == ("failed", "interrupted")


@pytest.mark.asyncio
async def test_recover_interrupted_fails_leftover_running_rows(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id = await _project(client)
    leftover = Run(id=str(uuid.uuid4()), project_id=project_id, type="draft", slot="01")
    db_session.add(leftover)
    await db_session.flush()

    count = await run_manager.recover_interrupted()

    assert count == 1
    recovered = await _reload(db_session, leftover.id)
    assert (recovered.state, recovered.error) == ("failed", "interrupted")
    assert recovered.finished_at is not None


@pytest.mark.asyncio
async def test_wait_for_unknown_run_returns_immediately(run_manager: RunManager) -> None:
    await asyncio.wait_for(run_manager.wait("does-not-exist"), timeout=1.0)
