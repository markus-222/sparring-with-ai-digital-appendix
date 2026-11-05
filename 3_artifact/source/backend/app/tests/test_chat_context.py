"""Chat context: sources, history, chip and state. DB-backed, no LLM."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.document import Document
from app.models.message import Message
from app.models.run import Run
from app.schemas.run import Slot
from app.schemas.tool_calls import ToolCallRecord, turn_record
from app.services.approval_service import approve_artifact
from app.services.chat_context import HISTORY_LIMIT, ChatContext, build_chat_context
from app.services.chat_events import record_event
from app.services.chat_prompt import HistoryRow
from app.services.draft_run import store_draft
from app.services.slot_service import get_slot_artifact

BASE_TIME = datetime(2026, 1, 1, tzinfo=UTC)
TEXT_CHANGE: dict[str, Any] = {
    "kind": "text_change",
    "find": "Offers take long.",
    "replace": "Offers take 3 days.",
}
TRANSCRIPT: list[dict[str, Any]] = [
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": "c1",
                "type": "function",
                "function": {"name": "read_artifact", "arguments": '{"slot": "01"}'},
            }
        ],
    },
    {"role": "tool", "tool_call_id": "c1", "name": "read_artifact", "content": "Artifact 01"},
    {"role": "assistant", "content": "Gelesen."},
]


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])


async def _session(client: AsyncClient, project_id: str) -> str:
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id, "title": None})
    return str(resp.json()["id"])


async def _project_with_session(client: AsyncClient) -> tuple[str, str]:
    project_id = await _project(client)
    return project_id, await _session(client, project_id)


async def _context(
    db_session: AsyncSession,
    project_id: str,
    session_id: str,
    *,
    open_artifact_id: str | None = None,
    comment_id: str | None = None,
    editor_open: bool = False,
) -> ChatContext:
    return await build_chat_context(
        db_session,
        project_id,
        session_id,
        open_artifact_id=open_artifact_id,
        comment_id=comment_id,
        editor_open=editor_open,
    )


async def _draft(db_session: AsyncSession, project_id: str, slot: Slot, content: str) -> Artifact:
    await store_draft(db_session, project_id, slot, content)
    return await get_slot_artifact(db_session, project_id, slot)


async def _approve(db_session: AsyncSession, project_id: str, slot: Slot, content: str) -> Artifact:
    artifact = await _draft(db_session, project_id, slot, content)
    await approve_artifact(db_session, artifact, force=True)
    return artifact


async def _comment(
    db_session: AsyncSession,
    artifact: Artifact,
    number: int = 1,
    status: str = "open",
    suggestion: dict[str, Any] | None = None,
) -> Comment:
    comment = Comment(
        artifact_id=artifact.id,
        number=number,
        review_number=1,
        title=f"Title {number}",
        description=f"Description {number}",
        sources=[],
        status=status,
        role="reviewer",
        suggestion=suggestion,
    )
    db_session.add(comment)
    await db_session.flush()
    return comment


async def _document(db_session: AsyncSession, project_id: str, filename: str, text: str) -> None:
    db_session.add(
        Document(
            id=str(uuid.uuid4()),
            project_id=project_id,
            filename=filename,
            content_type="text/markdown",
            size_bytes=1,
            full_text=text,
        )
    )
    await db_session.flush()


async def _message(
    db_session: AsyncSession,
    session_id: str,
    role: str,
    content: str,
    minute: int,
    tool_calls: dict[str, Any] | None = None,
) -> None:
    db_session.add(
        Message(
            session_id=session_id,
            role=role,
            content=content,
            tool_calls=tool_calls,
            created_at=BASE_TIME + timedelta(minutes=minute),
        )
    )
    await db_session.flush()


async def _drop_greeting(db_session: AsyncSession, session_id: str) -> None:
    await db_session.execute(delete(Message).where(Message.session_id == session_id))
    await db_session.flush()


@pytest.mark.asyncio
async def test_other_drafts_are_never_a_source(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    await _draft(db_session, project_id, "02", "## Secret draft\n")
    ctx = await _context(db_session, project_id, session_id)
    assert ctx.open_artifact is None
    assert ctx.approved == []


@pytest.mark.asyncio
async def test_other_drafts_stay_hidden_while_another_artifact_is_open(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    await _draft(db_session, project_id, "02", "## Secret draft\n")
    open_artifact = await _draft(db_session, project_id, "01", "## Problem\nVisible draft.\n")
    ctx = await _context(db_session, project_id, session_id, open_artifact_id=open_artifact.id)
    assert ctx.open_artifact is not None
    assert ctx.open_artifact.content == "## Problem\nVisible draft.\n"
    assert ctx.approved == []


@pytest.mark.asyncio
async def test_open_draft_is_a_source_with_its_open_comments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id, "01", "## Problem\nOffers take long.\n")
    open_comment = await _comment(db_session, artifact, number=1)
    await _comment(db_session, artifact, number=2, status="rejected")
    ctx = await _context(db_session, project_id, session_id, open_artifact_id=artifact.id)
    assert ctx.open_artifact is not None
    assert ctx.open_artifact.id == artifact.id
    assert ctx.open_artifact.slot == "01"
    assert ctx.open_artifact.status == "draft"
    assert ctx.open_artifact.content == "## Problem\nOffers take long.\n"
    assert [c.id for c in ctx.open_artifact.open_comments] == [open_comment.id]


@pytest.mark.asyncio
async def test_open_not_started_artifact_is_returned(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await get_slot_artifact(db_session, project_id, "03")
    ctx = await _context(db_session, project_id, session_id, open_artifact_id=artifact.id)
    assert ctx.open_artifact is not None
    assert ctx.open_artifact.slot == "03"
    assert ctx.open_artifact.status == "not_started"
    assert ctx.open_artifact.open_comments == []


@pytest.mark.asyncio
async def test_approved_artifacts_are_sources(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    await _approve(db_session, project_id, "01", "## Problem\nApproved text.\n")
    ctx = await _context(db_session, project_id, session_id)
    assert [(item.type, item.version_no, item.content) for item in ctx.approved] == [
        ("project_description", 1, "## Problem\nApproved text.\n")
    ]


@pytest.mark.asyncio
async def test_approved_source_marks_an_artifact_that_is_a_draft_again(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _approve(db_session, project_id, "01", "## Problem\nApproved text.\n")
    artifact.status = "draft"
    await db_session.flush()
    ctx = await _context(db_session, project_id, session_id)
    assert [item.current_status for item in ctx.approved] == ["draft"]


@pytest.mark.asyncio
async def test_approved_text_of_an_edited_artifact_is_still_the_source(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _approve(db_session, project_id, "01", "## Problem\nApproved text.\n")
    artifact.content = "## Problem\nEdited text.\n"
    artifact.status = "draft"
    await db_session.flush()
    ctx = await _context(db_session, project_id, session_id)
    assert [item.content for item in ctx.approved] == ["## Problem\nApproved text.\n"]


@pytest.mark.asyncio
async def test_approved_sources_include_the_open_slot(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _approve(db_session, project_id, "01", "## Problem\nApproved text.\n")
    await _approve(db_session, project_id, "02", "## Stakeholders\nApproved stakeholders.\n")
    ctx = await _context(db_session, project_id, session_id, open_artifact_id=artifact.id)
    assert [item.type for item in ctx.approved] == ["project_description", "stakeholder_analysis"]
    assert ctx.open_artifact is not None
    assert ctx.open_artifact.status == "approved"


@pytest.mark.asyncio
async def test_documents_are_sources(client: AsyncClient, db_session: AsyncSession) -> None:
    project_id, session_id = await _project_with_session(client)
    await _document(db_session, project_id, "brief.md", "Customer wants faster offers.")
    ctx = await _context(db_session, project_id, session_id)
    assert [(d.filename, d.full_text) for d in ctx.documents] == [
        ("brief.md", "Customer wants faster offers.")
    ]


@pytest.mark.asyncio
async def test_documents_of_other_projects_are_not_sources(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    other_project_id = await _project(client)
    await _document(db_session, other_project_id, "foreign.md", "Foreign text.")
    ctx = await _context(db_session, project_id, session_id)
    assert ctx.documents == []


@pytest.mark.asyncio
async def test_history_is_only_this_session_and_without_events(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, old_session_id = await _project_with_session(client)
    new_session_id = await _session(client, project_id)
    await _drop_greeting(db_session, old_session_id)
    await _drop_greeting(db_session, new_session_id)
    await _message(db_session, old_session_id, "user", "old question", 1)
    await _message(db_session, new_session_id, "user", "hi", 2)
    await _message(db_session, new_session_id, "system", "Artifact 01 approved.", 3)
    await _message(db_session, new_session_id, "assistant", "hello", 4)
    ctx = await _context(db_session, project_id, new_session_id)
    assert ctx.history == [
        HistoryRow(role="user", content="hi", transcript=[]),
        HistoryRow(role="assistant", content="hello", transcript=[]),
    ]


@pytest.mark.asyncio
async def test_history_keeps_the_newest_rows_up_to_the_limit_oldest_first(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    await _drop_greeting(db_session, session_id)
    for index in range(HISTORY_LIMIT + 2):
        role = "user" if index % 2 == 0 else "assistant"
        await _message(db_session, session_id, role, f"m{index}", index)
    ctx = await _context(db_session, project_id, session_id)
    assert HISTORY_LIMIT == 60
    assert [row.content for row in ctx.history] == [
        f"m{index}" for index in range(2, HISTORY_LIMIT + 2)
    ]
    assert ctx.history[0].role == "user"
    assert ctx.history[-1].role == "assistant"


@pytest.mark.asyncio
async def test_assistant_history_rows_carry_the_transcript_of_their_turn(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    await _drop_greeting(db_session, session_id)
    record = turn_record(
        [ToolCallRecord(name="read_artifact", arguments={"slot": "01"}, ok=True)], TRANSCRIPT, []
    )
    await _message(db_session, session_id, "user", "Lies 01", 1)
    await _message(db_session, session_id, "assistant", "Gelesen.", 2, tool_calls=record)
    old_format = {"calls": [{"name": "str_replace", "arguments": {}, "ok": True}]}
    await _message(db_session, session_id, "assistant", "Alte Antwort.", 3, tool_calls=old_format)
    ctx = await _context(db_session, project_id, session_id)
    assert ctx.history == [
        HistoryRow(role="user", content="Lies 01", transcript=[]),
        HistoryRow(role="assistant", content="Gelesen.", transcript=TRANSCRIPT),
        HistoryRow(role="assistant", content="Alte Antwort.", transcript=[]),
    ]


@pytest.mark.asyncio
async def test_confirmable_slots_come_from_the_latest_assistant_message_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    await _drop_greeting(db_session, session_id)
    assert (await _context(db_session, project_id, session_id)).confirmable == frozenset()

    asked = turn_record([], [{"role": "assistant", "content": "Fortfahren?"}], ["01", "03"])
    await _message(db_session, session_id, "user", "Ändere 01", 1)
    await _message(db_session, session_id, "assistant", "Fortfahren?", 2, tool_calls=asked)
    await _message(db_session, session_id, "user", "Ja", 3)
    ctx = await _context(db_session, project_id, session_id)
    assert ctx.confirmable == frozenset({"01", "03"})

    await _message(db_session, session_id, "assistant", "Geändert.", 4)
    ctx = await _context(db_session, project_id, session_id)
    assert ctx.confirmable == frozenset()


@pytest.mark.asyncio
async def test_events_are_part_of_the_context(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    db_session.add(
        Message(
            session_id=session_id,
            role="system",
            content="Artifact 01 approved.",
            agent_name="event",
            created_at=BASE_TIME,
        )
    )
    await db_session.flush()
    ctx = await _context(db_session, project_id, session_id)
    assert ctx.events == ["Artifact 01 approved."]


@pytest.mark.asyncio
async def test_events_are_the_newest_eight_oldest_first(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    for index in range(10):
        await record_event(db_session, project_id, f"e{index}")
    ctx = await _context(db_session, project_id, session_id)
    assert ctx.events == [f"e{index}" for index in range(2, 10)]


@pytest.mark.asyncio
async def test_foreign_open_artifact_is_ignored(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    other_project_id = await _project(client)
    foreign = await _draft(db_session, other_project_id, "01", "## Problem\nForeign draft.\n")
    foreign_comment = await _comment(db_session, foreign)
    ctx = await _context(
        db_session,
        project_id,
        session_id,
        open_artifact_id=foreign.id,
        comment_id=foreign_comment.id,
    )
    assert ctx.open_artifact is None
    assert ctx.chip is None


@pytest.mark.asyncio
async def test_unknown_open_artifact_is_ignored(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    ctx = await _context(
        db_session,
        project_id,
        session_id,
        open_artifact_id=str(uuid.uuid4()),
        comment_id=str(uuid.uuid4()),
    )
    assert ctx.open_artifact is None
    assert ctx.chip is None


@pytest.mark.asyncio
async def test_chip_requires_open_artifact_and_open_status(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id, "01", "## Problem\nOffers take long.\n")
    other = await _draft(db_session, project_id, "02", "## Stakeholders\n")
    chip_comment = await _comment(db_session, artifact, number=1)
    done_comment = await _comment(db_session, artifact, number=2, status="accepted")
    other_comment = await _comment(db_session, other, number=1)

    with_chip = await _context(
        db_session, project_id, session_id, open_artifact_id=artifact.id, comment_id=chip_comment.id
    )
    assert with_chip.chip is not None
    assert with_chip.chip.id == chip_comment.id

    without_artifact = await _context(
        db_session, project_id, session_id, comment_id=chip_comment.id
    )
    assert without_artifact.chip is None

    resolved = await _context(
        db_session, project_id, session_id, open_artifact_id=artifact.id, comment_id=done_comment.id
    )
    assert resolved.chip is None

    foreign_comment = await _context(
        db_session,
        project_id,
        session_id,
        open_artifact_id=artifact.id,
        comment_id=other_comment.id,
    )
    assert foreign_comment.chip is None


@pytest.mark.asyncio
async def test_chip_carries_its_suggestion(client: AsyncClient, db_session: AsyncSession) -> None:
    project_id, session_id = await _project_with_session(client)
    artifact = await _draft(db_session, project_id, "01", "## Problem\nOffers take long.\n")
    comment = await _comment(db_session, artifact, number=1, suggestion=TEXT_CHANGE)
    ctx = await _context(
        db_session, project_id, session_id, open_artifact_id=artifact.id, comment_id=comment.id
    )
    assert ctx.chip is not None
    assert (ctx.chip.title, ctx.chip.description) == ("Title 1", "Description 1")
    assert ctx.chip.suggestion == TEXT_CHANGE


@pytest.mark.asyncio
async def test_state_summary_without_artifacts_started(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    ctx = await _context(db_session, project_id, session_id)
    assert ctx.state_summary == (
        "01 Problem- and Scope-Definition: not_started (open comments: 0)\n"
        "02 Stakeholder Analysis: not_started (open comments: 0)\n"
        "03 Open Issues & Workshop Questions: not_started (open comments: 0)\n"
        "open artifact: none\n"
        "run: idle\n"
        "editor: closed"
    )


@pytest.mark.asyncio
async def test_state_summary_lists_slots_open_artifact_active_run_and_editor(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    approved = await _approve(db_session, project_id, "01", "## Problem\nApproved text.\n")
    await _comment(db_session, approved, number=1)
    draft = await _draft(db_session, project_id, "02", "## Stakeholders\n")
    await _comment(db_session, draft, number=1)
    await _comment(db_session, draft, number=2)
    await _comment(db_session, draft, number=3, status="accepted")
    db_session.add(
        Run(id=str(uuid.uuid4()), project_id=project_id, type="review", slot="03", state="running")
    )
    await db_session.flush()
    ctx = await _context(
        db_session, project_id, session_id, open_artifact_id=draft.id, editor_open=True
    )
    assert ctx.state_summary == (
        "01 Problem- and Scope-Definition: approved (open comments: 1)\n"
        "02 Stakeholder Analysis: draft (open comments: 2)\n"
        "03 Open Issues & Workshop Questions: not_started (open comments: 0)\n"
        "open artifact: 02\n"
        "run: active (review of 03)\n"
        "editor: open (unsaved edits)"
    )


@pytest.mark.asyncio
async def test_state_summary_ignores_other_projects(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    other_project_id = await _project(client)
    other = await _draft(db_session, other_project_id, "01", "## Problem\n")
    await _comment(db_session, other, number=1)
    db_session.add(
        Run(
            id=str(uuid.uuid4()),
            project_id=other_project_id,
            type="draft",
            slot="01",
            state="running",
        )
    )
    await db_session.flush()
    ctx = await _context(db_session, project_id, session_id)
    lines = ctx.state_summary.splitlines()
    assert lines[0] == "01 Problem- and Scope-Definition: not_started (open comments: 0)"
    assert lines[-2:] == ["run: idle", "editor: closed"]


async def _free_artifact(db_session: AsyncSession, project_id: str, title: str) -> Artifact:
    artifact = Artifact(
        project_id=project_id,
        type=f"free_{uuid.uuid4().hex}",
        title=title,
        content=f"# {title}\n",
        status="draft",
    )
    db_session.add(artifact)
    await db_session.flush()
    return artifact


async def test_state_summary_lists_free_artifacts_with_their_ids(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    agenda = await _free_artifact(db_session, project_id, "Agenda")
    await _free_artifact(db_session, await _project(client), "Foreign")

    ctx = await _context(db_session, project_id, session_id)

    assert ctx.state_summary == (
        "01 Problem- and Scope-Definition: not_started (open comments: 0)\n"
        "02 Stakeholder Analysis: not_started (open comments: 0)\n"
        "03 Open Issues & Workshop Questions: not_started (open comments: 0)\n"
        f'free-form artifact "Agenda": id {agenda.id}\n'
        "open artifact: none\n"
        "run: idle\n"
        "editor: closed"
    )


async def test_an_open_free_artifact_is_part_of_the_context(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, session_id = await _project_with_session(client)
    agenda = await _free_artifact(db_session, project_id, "Agenda")

    ctx = await _context(db_session, project_id, session_id, open_artifact_id=agenda.id)

    assert ctx.open_artifact is not None
    assert (ctx.open_artifact.id, ctx.open_artifact.slot) == (agenda.id, None)
    assert (ctx.open_artifact.title, ctx.open_artifact.content) == ("Agenda", "# Agenda\n")
    assert f"open artifact: free-form artifact {agenda.id}" in ctx.state_summary
