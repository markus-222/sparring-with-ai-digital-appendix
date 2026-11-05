"""Approval, versions and last-approved lookups."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.artifact_version import ArtifactVersion
from app.models.comment import Comment
from app.schemas.run import Slot
from app.services.approval_service import (
    ApprovalError,
    approve_artifact,
    get_last_approved,
    list_approved_foundation,
)
from app.services.slot_service import get_slot_artifact


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])


async def _draft(
    db: AsyncSession, project_id: str, slot: Slot, content: str, *, reviewed: bool = False
) -> Artifact:
    artifact = await get_slot_artifact(db, project_id, slot)
    artifact.status = "draft"
    artifact.content = content
    artifact.reviewed_since_change = reviewed
    await db.flush()
    return artifact


def _open_comment(artifact_id: str) -> Comment:
    return Comment(
        id=str(uuid.uuid4()),
        artifact_id=artifact_id,
        number=1,
        review_number=1,
        title="t",
        description="d",
        status="open",
    )


@pytest.mark.asyncio
async def test_approve_with_force_creates_version_one(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    artifact = await _draft(db_session, project_id, "01", "v1 text")

    resp = await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
    version = await get_last_approved(db_session, artifact.id)
    assert version is not None
    assert (version.version_no, version.content) == (1, "v1 text")


@pytest.mark.asyncio
async def test_approve_without_review_is_409_not_reviewed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    artifact = await _draft(db_session, project_id, "01", "text")

    resp = await client.post(f"/api/v1/artifacts/{artifact.id}/approve")

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "not_reviewed"


@pytest.mark.asyncio
async def test_approve_after_review_needs_no_force(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    artifact = await _draft(db_session, project_id, "01", "text", reviewed=True)

    resp = await client.post(f"/api/v1/artifacts/{artifact.id}/approve")

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_open_comment_blocks_approval_even_with_force(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    artifact = await _draft(db_session, project_id, "01", "text", reviewed=True)
    db_session.add(_open_comment(artifact.id))
    await db_session.flush()

    resp = await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "open_comments"


@pytest.mark.asyncio
async def test_double_approve_is_409_not_draft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    artifact = await _draft(db_session, project_id, "01", "text", reviewed=True)
    first = await client.post(f"/api/v1/artifacts/{artifact.id}/approve")

    second = await client.post(f"/api/v1/artifacts/{artifact.id}/approve")

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "not_draft"


@pytest.mark.asyncio
async def test_not_started_artifact_cannot_be_approved(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    artifact = await get_slot_artifact(db_session, project_id, "01")

    with pytest.raises(ApprovalError) as info:
        await approve_artifact(db_session, artifact, force=True)

    assert info.value.code == "not_draft"


@pytest.mark.asyncio
async def test_editing_approved_reverts_to_draft_and_second_approval_is_version_two(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    artifact = await _draft(db_session, project_id, "01", "v1 text", reviewed=True)
    await client.post(f"/api/v1/artifacts/{artifact.id}/approve")

    put = await client.put(f"/api/v1/artifacts/{artifact.id}", json={"content": "v2 text"})
    assert put.json()["status"] == "draft"
    assert put.json()["reviewed_since_change"] is False
    await db_session.refresh(artifact)
    assert artifact.reviewed_since_change is False

    again = await client.post(f"/api/v1/artifacts/{artifact.id}/approve", json={"force": True})

    assert again.status_code == 200
    versions = (
        (
            await db_session.execute(
                select(ArtifactVersion)
                .where(ArtifactVersion.artifact_id == artifact.id)
                .order_by(ArtifactVersion.version_no)
            )
        )
        .scalars()
        .all()
    )
    assert [(v.version_no, v.content) for v in versions] == [(1, "v1 text"), (2, "v2 text")]


@pytest.mark.asyncio
async def test_foundation_uses_last_approved_version_not_live_draft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client)
    one = await _draft(db_session, project_id, "01", "approved text", reviewed=True)
    await approve_artifact(db_session, one)
    one.status = "draft"
    one.content = "edited, not approved"
    await _draft(db_session, project_id, "02", "never approved")
    await db_session.flush()

    foundation = await list_approved_foundation(db_session, project_id)

    assert [(a.type, a.version_no, a.content) for a in foundation] == [
        ("project_description", 1, "approved text")
    ]
