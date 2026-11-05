"""Chat-driven artifact change: apply_chat_change."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.run import Run
from app.services.approval_service import approve_artifact
from app.services.change_service import ChangeError, apply_chat_change
from app.services.draft_run import store_draft
from app.services.slot_service import get_slot_artifact

CONTENT = "## Problem\nOffers take long.\n"
TWICE = "## Problem\nOffers take long.\nOffers are late.\n"


async def _setup(
    client: AsyncClient, db_session: AsyncSession, content: str = CONTENT
) -> tuple[str, Artifact]:
    project_id = str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])
    await store_draft(db_session, project_id, "01", content)
    return project_id, await get_slot_artifact(db_session, project_id, "01")


@pytest.mark.asyncio
async def test_change_replaces_text_and_marks_unreviewed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    artifact.reviewed_since_change = True

    result = await apply_chat_change(db_session, artifact, "take long", "take 3 days")

    assert artifact.content == "## Problem\nOffers take 3 days.\n"
    assert artifact.reviewed_since_change is False
    assert artifact.content[result.start : result.end] == "take 3 days"
    assert result.artifact_id == artifact.id
    assert result.was_approved is False
    assert artifact.status == "draft"


@pytest.mark.asyncio
async def test_change_with_empty_replace_deletes_the_text(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)

    result = await apply_chat_change(db_session, artifact, " take long", "")

    assert artifact.content == "## Problem\nOffers.\n"
    assert result.start == result.end


@pytest.mark.asyncio
async def test_change_on_approved_artifact_reverts_to_draft(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    await approve_artifact(db_session, artifact, force=True)
    assert artifact.status == "approved"

    result = await apply_chat_change(db_session, artifact, "long", "slow")

    assert artifact.status == "draft"
    assert result.was_approved is True
    assert artifact.content == "## Problem\nOffers take slow.\n"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("find", "code"),
    [("missing", "not_found"), ("Offers", "ambiguous"), ("", "empty_find")],
)
async def test_change_errors_leave_the_content_untouched(
    client: AsyncClient, db_session: AsyncSession, find: str, code: str
) -> None:
    _, artifact = await _setup(client, db_session, content=TWICE)
    artifact.reviewed_since_change = True

    with pytest.raises(ChangeError) as exc_info:
        await apply_chat_change(db_session, artifact, find, "X")

    assert exc_info.value.code == code
    assert artifact.content == TWICE
    assert artifact.reviewed_since_change is True


@pytest.mark.asyncio
async def test_change_is_locked_while_a_run_is_active(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact = await _setup(client, db_session)
    db_session.add(
        Run(id=str(uuid.uuid4()), project_id=project_id, type="draft", slot="01", state="running")
    )
    await db_session.flush()

    with pytest.raises(ChangeError) as exc_info:
        await apply_chat_change(db_session, artifact, "take long", "take 3 days")

    assert exc_info.value.code == "locked"
    assert artifact.content == CONTENT
