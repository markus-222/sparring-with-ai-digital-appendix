"""Fixed slots 01-03 exist for every project."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.project import Project
from app.models.run import Run
from app.models.workshop_question import WorkshopQuestion
from app.schemas.run import Slot
from app.services.approval_service import approve_artifact, get_last_approved
from app.services.slot_service import SLOT_TYPES, ensure_slots, get_slot_artifact

_SLOT_ORDER = ["project_description", "stakeholder_analysis", "open_issues"]


async def _new_project(db: AsyncSession) -> str:
    # Callers request the `client` fixture, which persists the fake owner user.
    project = Project(id=str(uuid.uuid4()), name="P", owner_id="test-user-id")
    db.add(project)
    await db.flush()
    return project.id


def _artifact(project_id: str, type_: str, **kwargs: object) -> Artifact:
    return Artifact(
        id=str(uuid.uuid4()),
        project_id=project_id,
        type=type_,
        title=type_,
        content="x",
        status="draft",
        **kwargs,
    )


@pytest.mark.asyncio
async def test_ensure_slots_creates_three_not_started_and_is_idempotent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _new_project(db_session)

    created = await ensure_slots(db_session, project_id)

    assert [a.type for a in created] == _SLOT_ORDER
    assert [a.title for a in created] == [
        "Problem- and Scope-Definition",
        "Stakeholder Analysis",
        "Open Issues & Workshop Questions",
    ]
    assert {a.status for a in created} == {"not_started"}
    assert {a.content for a in created} == {""}
    assert await ensure_slots(db_session, project_id) == []
    count = (
        await db_session.execute(
            select(func.count()).select_from(Artifact).where(Artifact.project_id == project_id)
        )
    ).scalar_one()
    assert count == 3


@pytest.mark.asyncio
async def test_get_slot_artifact_maps_slot_to_type(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _new_project(db_session)
    await ensure_slots(db_session, project_id)

    artifact = await get_slot_artifact(db_session, project_id, "02")

    assert artifact.type == "stakeholder_analysis"


@pytest.mark.asyncio
async def test_create_project_endpoint_creates_slots(client: AsyncClient) -> None:
    project = (await client.post("/api/v1/projects", json={"name": "Slots"})).json()

    resp = await client.get("/api/v1/artifacts", params={"project_id": project["id"]})

    assert sorted(a["type"] for a in resp.json()) == sorted(SLOT_TYPES)
    assert {a["status"] for a in resp.json()} == {"not_started"}


async def _approved_slot_with_comment(db: AsyncSession, project_id: str, slot: Slot) -> Artifact:
    artifact = await get_slot_artifact(db, project_id, slot)
    artifact.status = "draft"
    artifact.content = "# Text"
    artifact.reviewed_since_change = True
    await db.flush()
    await approve_artifact(db, artifact)
    db.add(
        Comment(
            id=str(uuid.uuid4()),
            artifact_id=artifact.id,
            number=1,
            review_number=1,
            title="t",
            description="d",
            status="open",
        )
    )
    await db.flush()
    return artifact


@pytest.mark.asyncio
async def test_deleting_a_slot_artifact_resets_it_to_not_started(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = str((await client.post("/api/v1/projects", json={"name": "Slots"})).json()["id"])
    artifact = await _approved_slot_with_comment(db_session, project_id, "01")

    resp = await client.delete(f"/api/v1/artifacts/{artifact.id}")

    assert resp.status_code == 204
    await db_session.refresh(artifact)
    assert (artifact.status, artifact.content, artifact.reviewed_since_change) == (
        "not_started",
        "",
        False,
    )
    assert await get_last_approved(db_session, artifact.id) is None
    comments = await db_session.execute(select(Comment).where(Comment.artifact_id == artifact.id))
    assert comments.scalars().all() == []
    listed = (await client.get("/api/v1/artifacts", params={"project_id": project_id})).json()
    assert len(listed) == 3


@pytest.mark.asyncio
async def test_deleting_artifact_03_drops_the_collected_workshop_questions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = str((await client.post("/api/v1/projects", json={"name": "Slots"})).json()["id"])
    artifact = await _approved_slot_with_comment(db_session, project_id, "03")
    db_session.add(WorkshopQuestion(project_id=project_id, text="Who decides?"))
    await db_session.flush()

    resp = await client.delete(f"/api/v1/artifacts/{artifact.id}")

    assert resp.status_code == 204
    questions = await db_session.execute(
        select(WorkshopQuestion).where(WorkshopQuestion.project_id == project_id)
    )
    assert questions.scalars().all() == []


@pytest.mark.asyncio
async def test_deleting_artifact_01_keeps_the_workshop_questions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = str((await client.post("/api/v1/projects", json={"name": "Slots"})).json()["id"])
    artifact = await _approved_slot_with_comment(db_session, project_id, "01")
    db_session.add(WorkshopQuestion(project_id=project_id, text="Who decides?"))
    await db_session.flush()

    await client.delete(f"/api/v1/artifacts/{artifact.id}")

    questions = await db_session.execute(
        select(WorkshopQuestion).where(WorkshopQuestion.project_id == project_id)
    )
    assert len(questions.scalars().all()) == 1


@pytest.mark.asyncio
async def test_deleting_a_slot_artifact_is_blocked_during_a_run(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = str((await client.post("/api/v1/projects", json={"name": "Slots"})).json()["id"])
    artifact = await _approved_slot_with_comment(db_session, project_id, "01")
    db_session.add(
        Run(id=str(uuid.uuid4()), project_id=project_id, type="draft", slot="02", state="running")
    )
    await db_session.flush()

    resp = await client.delete(f"/api/v1/artifacts/{artifact.id}")

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "run_active"
    await db_session.refresh(artifact)
    assert artifact.status == "approved"


@pytest.mark.asyncio
async def test_free_type_artifact_can_still_be_deleted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project = (await client.post("/api/v1/projects", json={"name": "Free"})).json()
    free = _artifact(project["id"], "risk")
    db_session.add(free)
    await db_session.flush()

    resp = await client.delete(f"/api/v1/artifacts/{free.id}")

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_slot_type_is_unique_per_project_but_free_types_are_not(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _new_project(db_session)
    await ensure_slots(db_session, project_id)

    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(_artifact(project_id, "open_issues"))
            await db_session.flush()

    db_session.add(_artifact(project_id, "risk"))
    db_session.add(_artifact(project_id, "risk"))
    await db_session.flush()
