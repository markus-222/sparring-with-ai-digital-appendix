"""Draft run worker: inputs, format fix, atomic save, failure semantics.

Test rule: between `start()` and `wait()` do not touch `db_session`/`client`.
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.fake_llm import FakeLLM
from app.models.artifact import Artifact
from app.models.artifact_version import ArtifactVersion
from app.models.comment import Comment
from app.models.document import Document
from app.models.run import Run
from app.models.workshop_question import WorkshopQuestion
from app.schemas.run import RunType, Slot
from app.services.draft_run import make_draft_worker
from app.services.run_manager import RunManager, RunWorker
from app.services.slot_service import get_slot_artifact

GOOD_01 = (
    "## 1. Executive Summary\n- Offers take long to prepare [[doc:a.md]]\n\n"
    "## 2. Kontext & Stakeholder\n- Sales [[doc:a.md]]\n\n"
    "## 3. Problem Space\n- Manual copying [[doc:a.md]]\n\n"
    "## 4. Ziele & Erfolgskriterien\n- Lost deals [[doc:a.md]]\n\n"
    "## 5. Scope Definition\n- Offer process [[doc:a.md]]\n\n"
    "## 6. Project Requirements & Constraints\n- Budget [[doc:a.md]]"
)
BAD_01 = GOOD_01.replace("## 5. Scope Definition\n- Offer process [[doc:a.md]]\n\n", "")
GOOD_02 = (
    "## 1. Stakeholder Identification & Classification\n### Sales\n"
    "- Roles: Sales lead [[doc:a.md]]\n- Influence: Approves offers [[doc:a.md]]\n\n"
    "## 2. Lücken in der Beteiligung (Blind Spots)\n- Unknown owner [[doc:a.md]]\n\n"
    "## 3. Stakeholder Needs & Concerns\n- Sales: Offers within 2 days [[doc:a.md]]\n\n"
    "## 4. Potenzielle Konflikte & Spannungsfelder\n- Nicht in den Dokumenten spezifiziert.\n\n"
    "## 5. Potenziell negativ betroffene Stakeholder\n- Nicht in den Dokumenten spezifiziert.\n\n"
    "## 6. Unsicherheiten & Annahmen\n- Nicht in den Dokumenten spezifiziert."
)
GOOD_03 = "### Users\nOpen point [[doc:a.md]]\n**Question:** How many?"
CONFLICT_LINE = "- ⚠ CONFLICT: Users: 200 [[doc:a.md]] vs. 2000 [[doc:b.md]]"


@pytest.fixture(autouse=True)
def _register_draft_worker(run_workers: dict[RunType, RunWorker], fake_llm: FakeLLM) -> None:
    run_workers["draft"] = make_draft_worker(fake_llm)


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "M"})).json()["id"])


async def _reload(db: AsyncSession, run_id: str) -> Run:
    result = await db.execute(
        select(Run).where(Run.id == run_id).execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _artifact(db: AsyncSession, project_id: str, slot: Slot) -> Artifact:
    artifact = await get_slot_artifact(db, project_id, slot)
    await db.refresh(artifact)
    return artifact


async def _doc(db: AsyncSession, project_id: str, name: str, text: str) -> None:
    db.add(
        Document(
            id=str(uuid.uuid4()),
            project_id=project_id,
            filename=name,
            content_type="text/markdown",
            size_bytes=len(text),
            full_text=text,
        )
    )
    await db.flush()


def _comment(artifact_id: str, number: int, status: str, title: str) -> Comment:
    return Comment(
        id=str(uuid.uuid4()),
        artifact_id=artifact_id,
        number=number,
        review_number=1,
        title=title,
        description="d",
        sources=[],
        status=status,
    )


async def _run(manager: RunManager, project_id: str, slot: Slot = "01") -> str:
    run = await manager.start(project_id, "draft", slot)
    await manager.wait(run.id)
    return run.id


def _prompt(llm: FakeLLM, index: int) -> str:
    return str(llm.requests[index].messages[-1]["content"])


@pytest.mark.asyncio
async def test_happy_path_saves_the_draft_and_reports_the_last_step(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id = await _project(client)
    await _doc(db_session, project_id, "a.md", "Text A")
    await db_session.commit()
    fake_llm.enqueue(GOOD_01)

    run_id = await _run(run_manager, project_id)

    run = await _reload(db_session, run_id)
    assert (run.state, run.step, run.error) == ("succeeded", "saving", None)
    artifact = await _artifact(db_session, project_id, "01")
    assert artifact.status == "draft"
    assert artifact.content == GOOD_01
    assert artifact.reviewed_since_change is False
    assert len(fake_llm.requests) == 1
    assert "Text A" in _prompt(fake_llm, 0)


@pytest.mark.asyncio
async def test_a_format_finding_triggers_one_fix_call(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id = await _project(client)
    await _doc(db_session, project_id, "a.md", "Text A")
    await db_session.commit()
    fake_llm.enqueue(BAD_01, GOOD_01)

    run_id = await _run(run_manager, project_id)

    assert (await _reload(db_session, run_id)).state == "succeeded"
    assert len(fake_llm.requests) == 2
    assert "missing_heading" in _prompt(fake_llm, 1)
    assert (await _artifact(db_session, project_id, "01")).content == GOOD_01


@pytest.mark.asyncio
async def test_the_format_fix_runs_only_once(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id = await _project(client)
    await _doc(db_session, project_id, "a.md", "Text A")
    await db_session.commit()
    fake_llm.enqueue(BAD_01, BAD_01)

    run_id = await _run(run_manager, project_id)

    assert (await _reload(db_session, run_id)).state == "succeeded"
    assert len(fake_llm.requests) == 2
    assert (await _artifact(db_session, project_id, "01")).content == BAD_01.strip()


@pytest.mark.asyncio
async def test_recreating_replaces_open_comments_and_keeps_resolved_ones(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id = await _project(client)
    await _doc(db_session, project_id, "a.md", "Text A")
    artifact = await get_slot_artifact(db_session, project_id, "01")
    artifact.status = "draft"
    artifact.content = "old"
    artifact.reviewed_since_change = True
    db_session.add_all(
        [
            _comment(artifact.id, 1, "open", "Open one"),
            _comment(artifact.id, 2, "rejected", "Rejected one"),
        ]
    )
    await db_session.commit()
    fake_llm.enqueue(GOOD_01)

    run_id = await _run(run_manager, project_id)

    assert (await _reload(db_session, run_id)).state == "succeeded"
    fresh = await _artifact(db_session, project_id, "01")
    assert (fresh.content, fresh.reviewed_since_change) == (GOOD_01, False)
    rows = await db_session.execute(
        select(Comment)
        .where(Comment.artifact_id == fresh.id)
        .execution_options(populate_existing=True)
    )
    assert [(c.title, c.status) for c in rows.scalars().all()] == [("Rejected one", "rejected")]


@pytest.mark.asyncio
async def test_llm_error_fails_the_run_and_leaves_the_artifact_untouched(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id = await _project(client)
    fake_llm.enqueue(RuntimeError("boom"))

    run_id = await _run(run_manager, project_id)

    run = await _reload(db_session, run_id)
    assert (run.state, run.error) == ("failed", "RuntimeError")
    artifact = await _artifact(db_session, project_id, "01")
    assert (artifact.status, artifact.content) == ("not_started", "")


@pytest.mark.asyncio
async def test_blank_reply_fails_the_run(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id = await _project(client)
    fake_llm.enqueue("")

    run_id = await _run(run_manager, project_id)

    run = await _reload(db_session, run_id)
    assert (run.state, run.error) == ("failed", "EmptyDraftError")
    assert (await _artifact(db_session, project_id, "01")).status == "not_started"


@pytest.mark.asyncio
async def test_slot_03_draft_gets_questions_markers_and_rejected_comments(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id = await _project(client)
    approved = await get_slot_artifact(db_session, project_id, "01")
    approved_content = f"## Problem\n{CONFLICT_LINE}\n"
    approved.status = "approved"
    approved.content = approved_content
    db_session.add(ArtifactVersion(artifact_id=approved.id, version_no=1, content=approved_content))
    db_session.add(
        WorkshopQuestion(id=str(uuid.uuid4()), project_id=project_id, text="Who maintains courses?")
    )
    db_session.add(_comment(approved.id, 1, "rejected", "Budget"))
    await db_session.commit()
    fake_llm.enqueue(GOOD_03)

    run_id = await _run(run_manager, project_id, "03")

    assert (await _reload(db_session, run_id)).state == "succeeded"
    assert len(fake_llm.requests) == 1
    prompt = _prompt(fake_llm, 0)
    assert "Who maintains courses?" in prompt
    assert "⚠ CONFLICT: Users" in prompt
    assert "Do not include these points" in prompt
    assert "Budget" in prompt
    saved = await _artifact(db_session, project_id, "03")
    assert (saved.status, saved.content) == ("draft", GOOD_03)


@pytest.mark.asyncio
@pytest.mark.parametrize("slot", ["01", "02", "03"])
async def test_an_existing_draft_goes_to_the_model_to_be_merged(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    fake_llm: FakeLLM,
    slot: Slot,
) -> None:
    project_id = await _project(client)
    await _doc(db_session, project_id, "a.md", "Text A")
    artifact = await get_slot_artifact(db_session, project_id, slot)
    artifact.status = "approved"
    artifact.content = "Typed by hand"
    db_session.add(_comment(artifact.id, 1, "open", "Open one"))
    await db_session.commit()
    merged = {"01": GOOD_01, "02": GOOD_02, "03": GOOD_03}[slot]
    fake_llm.enqueue(merged)

    run_id = await _run(run_manager, project_id, slot)

    assert (await _reload(db_session, run_id)).state == "succeeded"
    prompt = _prompt(fake_llm, 0)
    assert "<existing_draft>\nTyped by hand\n</existing_draft>" in prompt
    assert "keep every point" in prompt
    saved = await _artifact(db_session, project_id, slot)
    assert saved.content == merged
    assert (saved.status, saved.reviewed_since_change) == ("draft", False)
    rows = await db_session.execute(
        select(Comment)
        .where(Comment.artifact_id == saved.id)
        .execution_options(populate_existing=True)
    )
    assert rows.scalars().all() == []


@pytest.mark.asyncio
async def test_an_empty_artifact_gets_a_fresh_draft_without_the_merge_block(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id = await _project(client)
    await _doc(db_session, project_id, "a.md", "Text A")
    await db_session.commit()
    fake_llm.enqueue(GOOD_01)

    await _run(run_manager, project_id)

    prompt = _prompt(fake_llm, 0)
    assert "<existing_draft>" not in prompt
    assert "keep every point" not in prompt
