"""Run endpoints: start (202), poll, active, lock.

While a worker is blocked on an Event it does no DB work, so the test may use
the client in between (see Design decision 8).
"""

import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.run import RunType
from app.services.draft_run import store_draft
from app.services.run_manager import RunContext, RunManager, RunWorker


def _blocked(release: asyncio.Event) -> RunWorker:
    async def worker(ctx: RunContext) -> None:
        await release.wait()

    return worker


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "A"})).json()["id"])


@pytest.mark.asyncio
async def test_start_poll_and_finish_cycle(
    client: AsyncClient, run_manager: RunManager, run_workers: dict[RunType, RunWorker]
) -> None:
    release = asyncio.Event()
    run_workers["draft"] = _blocked(release)
    project_id = await _project(client)

    started = await client.post(
        f"/api/v1/projects/{project_id}/runs", json={"type": "draft", "slot": "01"}
    )

    assert started.status_code == 202
    body = started.json()
    assert (body["state"], body["type"], body["slot"], body["project_id"]) == (
        "running",
        "draft",
        "01",
        project_id,
    )
    polled = await client.get(f"/api/v1/runs/{body['id']}")
    assert polled.json()["state"] == "running"
    release.set()
    await run_manager.wait(body["id"])
    final = (await client.get(f"/api/v1/runs/{body['id']}")).json()
    assert final["state"] == "succeeded" and final["finished_at"] is not None


@pytest.mark.asyncio
async def test_second_start_while_running_is_409(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    release = asyncio.Event()
    run_workers["draft"] = _blocked(release)
    run_workers["review"] = _blocked(release)
    project_id = await _project(client)
    await store_draft(db_session, project_id, "01", "## Problem\nText")
    first = await client.post(
        f"/api/v1/projects/{project_id}/runs", json={"type": "draft", "slot": "01"}
    )

    second = await client.post(
        f"/api/v1/projects/{project_id}/runs", json={"type": "review", "slot": "01"}
    )

    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "run_active"
    release.set()
    await run_manager.wait(first.json()["id"])


@pytest.mark.asyncio
async def test_review_start_without_a_draft_is_409_not_draft(client: AsyncClient) -> None:
    project_id = await _project(client)

    resp = await client.post(
        f"/api/v1/projects/{project_id}/runs", json={"type": "review", "slot": "01"}
    )

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "not_draft"


@pytest.mark.asyncio
async def test_start_without_registered_worker_is_501(client: AsyncClient) -> None:
    project_id = await _project(client)

    resp = await client.post(
        f"/api/v1/projects/{project_id}/runs", json={"type": "draft", "slot": "01"}
    )

    assert resp.status_code == 501
    assert resp.json()["detail"]["code"] == "not_available"


@pytest.mark.asyncio
async def test_start_for_unknown_project_is_404(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/projects/nope/runs", json={"type": "draft", "slot": "01"})

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_invalid_slot_is_422(client: AsyncClient) -> None:
    project_id = await _project(client)

    resp = await client.post(
        f"/api/v1/projects/{project_id}/runs", json={"type": "draft", "slot": "04"}
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_unknown_run_is_404(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/runs/nope")).status_code == 404


@pytest.mark.asyncio
async def test_active_run_endpoint_returns_null_then_the_run(
    client: AsyncClient, run_manager: RunManager, run_workers: dict[RunType, RunWorker]
) -> None:
    release = asyncio.Event()
    run_workers["draft"] = _blocked(release)
    project_id = await _project(client)
    idle = await client.get(f"/api/v1/projects/{project_id}/runs/active")
    assert idle.status_code == 200 and idle.json() is None
    started = (
        await client.post(
            f"/api/v1/projects/{project_id}/runs", json={"type": "draft", "slot": "01"}
        )
    ).json()

    active = await client.get(f"/api/v1/projects/{project_id}/runs/active")

    assert active.json()["id"] == started["id"]
    release.set()
    await run_manager.wait(started["id"])
    assert (await client.get(f"/api/v1/projects/{project_id}/runs/active")).json() is None


@pytest.mark.asyncio
async def test_artifact_edit_is_409_while_run_endpoint_run_is_active(
    client: AsyncClient, run_manager: RunManager, run_workers: dict[RunType, RunWorker]
) -> None:
    release = asyncio.Event()
    run_workers["draft"] = _blocked(release)
    project_id = await _project(client)
    artifacts = (await client.get("/api/v1/artifacts", params={"project_id": project_id})).json()
    started = (
        await client.post(
            f"/api/v1/projects/{project_id}/runs", json={"type": "draft", "slot": "01"}
        )
    ).json()

    resp = await client.put(f"/api/v1/artifacts/{artifacts[0]['id']}", json={"content": "x"})

    assert resp.status_code == 409 and resp.json()["detail"]["code"] == "run_active"
    release.set()
    await run_manager.wait(started["id"])
