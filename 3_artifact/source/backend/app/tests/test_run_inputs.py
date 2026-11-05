"""Read-only run input builders. DB-backed."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact_version import ArtifactVersion
from app.models.comment import Comment
from app.models.document import Document
from app.models.workshop_question import WorkshopQuestion
from app.schemas.run import Slot
from app.services.run_inputs import build_inputs, build_resolved_findings
from app.services.slot_service import ensure_slots, get_slot_artifact

CONFLICT_LINE = "- ⚠ CONFLICT: Users: 200 [[doc:a.md]] vs. 2,000 [[doc:b.md]]"


async def _project(client: AsyncClient, db: AsyncSession) -> str:
    project_id = str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])
    await ensure_slots(db, project_id)
    return project_id


async def _document(db: AsyncSession, project_id: str, filename: str, text: str) -> None:
    db.add(
        Document(
            id=str(uuid.uuid4()),
            project_id=project_id,
            filename=filename,
            content_type="text/markdown",
            size_bytes=1,
            full_text=text,
        )
    )
    await db.flush()


async def _approve(db: AsyncSession, project_id: str, slot: Slot, content: str) -> str:
    artifact = await get_slot_artifact(db, project_id, slot)
    artifact.status = "approved"
    artifact.content = content
    db.add(ArtifactVersion(artifact_id=artifact.id, version_no=1, content=content))
    await db.flush()
    return artifact.id


def _comment(artifact_id: str, number: int, status: str, title: str) -> Comment:
    return Comment(
        id=str(uuid.uuid4()),
        artifact_id=artifact_id,
        number=number,
        review_number=1,
        title=title,
        description="explanation",
        status=status,
    )


@pytest.mark.asyncio
async def test_slot_01_draft_has_documents_and_no_approved_artifacts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client, db_session)
    await _document(db_session, project_id, "a.md", "Text A")

    inputs = await build_inputs(db_session, project_id, "01", for_draft=True)

    assert '<document name="a.md">' in inputs.text
    assert "Text A" in inputs.text
    assert inputs.known_documents == frozenset({"a.md"})
    assert "<approved_artifact" not in inputs.text


@pytest.mark.asyncio
async def test_slot_02_includes_approved_01_but_not_itself(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client, db_session)
    await _approve(db_session, project_id, "01", "Approved 01")
    await _approve(db_session, project_id, "02", "Approved 02")

    inputs = await build_inputs(db_session, project_id, "02", for_draft=True)

    assert '<approved_artifact slot="01" type="project_description" version="1">' in inputs.text
    assert "Approved 01" in inputs.text
    assert "stakeholder_analysis" not in inputs.text
    assert "Approved 02" not in inputs.text


@pytest.mark.asyncio
async def test_slot_03_draft_has_questions_markers_and_rejected_comments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client, db_session)
    approved_id = await _approve(db_session, project_id, "01", f"## Problem\n{CONFLICT_LINE}\n")
    draft_02 = await get_slot_artifact(db_session, project_id, "02")
    draft_02.status = "draft"
    draft_02.content = "- ⚠ CONFLICT: only in an unapproved draft"
    db_session.add(
        WorkshopQuestion(id=str(uuid.uuid4()), project_id=project_id, text="Who maintains courses?")
    )
    db_session.add(_comment(approved_id, 1, "rejected", "Rejected point"))
    await db_session.flush()

    inputs = await build_inputs(db_session, project_id, "03", for_draft=True)

    assert "<workshop_questions>" in inputs.text
    assert "Who maintains courses?" in inputs.text
    assert f"<markers>\n[01] {CONFLICT_LINE}\n</markers>" in inputs.text
    assert "only in an unapproved draft" not in inputs.text
    assert "<rejected_comments>" in inputs.text
    assert "Do not include these points" in inputs.text
    assert "Rejected point" in inputs.text


@pytest.mark.asyncio
@pytest.mark.parametrize("slot", ["01", "02", "03"])
async def test_draft_inputs_carry_the_existing_draft_only_when_given(
    client: AsyncClient, db_session: AsyncSession, slot: Slot
) -> None:
    project_id = await _project(client, db_session)
    existing = "## Problem\nTyped by hand\n"

    plain = await build_inputs(db_session, project_id, slot, for_draft=True)
    merging = await build_inputs(
        db_session, project_id, slot, for_draft=True, existing_draft=existing
    )
    review = await build_inputs(
        db_session, project_id, slot, for_draft=False, existing_draft=existing
    )

    assert "<existing_draft>" not in plain.text
    assert f"<existing_draft>\n{existing.strip()}\n</existing_draft>" in merging.text
    assert merging.text.index("<existing_draft>") < merging.text.index("<target_artifact")
    assert "<existing_draft>" not in review.text


@pytest.mark.asyncio
async def test_slot_03_review_inputs_have_none_of_the_03_blocks(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client, db_session)
    approved_id = await _approve(db_session, project_id, "01", f"## Problem\n{CONFLICT_LINE}\n")
    db_session.add(
        WorkshopQuestion(id=str(uuid.uuid4()), project_id=project_id, text="Who maintains courses?")
    )
    db_session.add(_comment(approved_id, 1, "rejected", "Rejected point"))
    await db_session.flush()

    inputs = await build_inputs(db_session, project_id, "03", for_draft=False)

    assert "<workshop_questions>" not in inputs.text
    assert "<markers>" not in inputs.text
    assert "<rejected_comments>" not in inputs.text


@pytest.mark.asyncio
async def test_resolved_findings_list_only_resolved_comments_in_number_order(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id = await _project(client, db_session)
    artifact = await get_slot_artifact(db_session, project_id, "01")
    db_session.add_all(
        [
            _comment(artifact.id, 3, "done_manually", "Third"),
            _comment(artifact.id, 1, "rejected", "First"),
            _comment(artifact.id, 2, "open", "Still open"),
            _comment(artifact.id, 4, "accepted", "Fourth"),
        ]
    )
    await db_session.flush()

    findings = await build_resolved_findings(db_session, artifact.id)

    assert findings.splitlines() == [
        "- [rejected] First — explanation",
        "- [done_manually] Third — explanation",
        "- [accepted] Fourth — explanation",
    ]
    other = await get_slot_artifact(db_session, project_id, "02")
    assert await build_resolved_findings(db_session, other.id) == ""
