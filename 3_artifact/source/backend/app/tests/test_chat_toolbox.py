"""ChatToolbox: every guard, result text, queued UI event and database effect of the chat tools."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, TypeVar

import pytest
from httpx import AsyncClient
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.chat_tools import build_tool_specs
from app.agents.tool_loop import ToolOutcome
from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.message import Message
from app.models.run import Run
from app.models.session import Session
from app.models.workshop_question import WorkshopQuestion
from app.schemas.chat import (
    ArtifactChangedEvent,
    ChatEvent,
    ChipClearedEvent,
    OpenArtifactEvent,
    ProposalSettledEvent,
    RunStartedEvent,
)
from app.schemas.proposal import QuestionProposal, proposal_column, read_proposal
from app.schemas.run import RunType, Slot
from app.schemas.tool_calls import (
    ToolCallRecord,
    ToolCallsRecord,
    read_turn_record,
    turn_record,
)
from app.services import chat_toolbox
from app.services.approval_service import approve_artifact
from app.services.chat_context import OpenArtifact
from app.services.chat_toolbox import ChatToolbox
from app.services.draft_run import store_draft
from app.services.open_issues_questions import QuestionAdded, QuestionBlockedError
from app.services.question_proposals import new_proposal
from app.services.run_manager import RunContext, RunManager, RunWorker
from app.services.slot_service import ensure_slots, get_slot_artifact

CONTENT_01 = "## Problem\nOffers take long.\n"
CHANGED_01 = "## Problem\nOffers take 3 days.\n"
TWO_MATCHES = "## Problem\nOffers take long. Offers are slow.\n"
QUESTION = "Wer zahlt den Betrieb?"
OTHER_QUESTION = "Welche Systeme sind im Einsatz?"

RUN_ACTIVE = (
    "A background run is active. Changes are not possible until it has finished; nothing was "
    "changed. Tell the user and ask them to repeat the request afterwards."
)
EDITOR_OPEN = (
    "The user has unsaved edits open in the editor. Nothing was changed. "
    "Ask the user to save or discard them first."
)
_Event = TypeVar("_Event", bound=BaseModel)

APPROVED_01 = (
    "Artifact 01 is approved. This would revoke the approval, so the user must confirm first. "
    "Nothing was changed. Ask the user in one sentence whether to continue; call the tool again "
    "with revoke_approval=true only after they said yes."
)
NOT_REGISTERED_01 = (
    "Artifact 01 is approved and the confirmation question was not registered before this call, "
    "so it counts from now. Nothing was changed. Ask the user once more, in one sentence, "
    "whether the approval of 01 may be revoked; after their yes call the tool again with "
    "revoke_approval=true."
)


async def _project_and_session(
    client: AsyncClient, db_session: AsyncSession
) -> tuple[str, Session]:
    project_id = str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id, "title": None})
    session = await db_session.get(Session, str(resp.json()["id"]))
    assert session is not None
    return project_id, session


async def _draft(
    db_session: AsyncSession, project_id: str, slot: Slot = "01", content: str = CONTENT_01
) -> Artifact:
    await ensure_slots(db_session, project_id)
    await store_draft(db_session, project_id, slot, content)
    return await get_slot_artifact(db_session, project_id, slot)


async def _approved(
    db_session: AsyncSession, project_id: str, slot: Slot = "01", content: str = CONTENT_01
) -> Artifact:
    artifact = await _draft(db_session, project_id, slot, content)
    await approve_artifact(db_session, artifact, force=True)
    return artifact


async def _comment(
    db_session: AsyncSession,
    artifact: Artifact,
    *,
    status: str = "open",
    number: int = 1,
    title: str = "Unclear scope",
) -> Comment:
    comment = Comment(
        artifact_id=artifact.id,
        number=number,
        review_number=1,
        title=title,
        description="The scope is vague.",
        sources=[],
        status=status,
        role="reviewer",
    )
    db_session.add(comment)
    await db_session.flush()
    return comment


async def _start_run(db_session: AsyncSession, project_id: str) -> None:
    db_session.add(
        Run(id=str(uuid.uuid4()), project_id=project_id, type="draft", slot="02", state="running")
    )
    await db_session.flush()


async def _noop(ctx: RunContext) -> None:
    return None


def _open(artifact: Artifact, slot: Slot = "01") -> OpenArtifact:
    return OpenArtifact(
        id=artifact.id,
        slot=slot,
        status=artifact.status,
        content=artifact.content,
        open_comments=[],
    )


def _toolbox(
    db_session: AsyncSession,
    run_manager: RunManager,
    project_id: str,
    session: Session,
    *,
    open_artifact: OpenArtifact | None = None,
    chip: Comment | None = None,
    editor_open: bool = False,
    confirmable: frozenset[Slot] = frozenset(),
) -> ChatToolbox:
    return ChatToolbox(
        db_session,
        run_manager,
        session_id=session.id,
        project_id=project_id,
        open_artifact=open_artifact,
        chip=chip,
        editor_open=editor_open,
        confirmable=confirmable,
    )


def _names(events: list[ChatEvent]) -> list[str]:
    return [name for name, _ in events]


def _payload(events: list[ChatEvent], kind: type[_Event]) -> _Event:
    found = [data for _, data in events if isinstance(data, kind)]
    assert len(found) == 1
    return found[0]


async def _runs(db_session: AsyncSession, project_id: str) -> list[Run]:
    result = await db_session.execute(select(Run).where(Run.project_id == project_id))
    return list(result.scalars().all())


async def _reload(db_session: AsyncSession, artifact: Artifact) -> Artifact:
    await db_session.refresh(artifact)
    return artifact


async def _question_texts(db_session: AsyncSession, project_id: str) -> list[str]:
    result = await db_session.execute(
        select(WorkshopQuestion.text).where(WorkshopQuestion.project_id == project_id)
    )
    return sorted(result.scalars().all())


async def _card(
    db_session: AsyncSession,
    session: Session,
    texts: list[str],
    *,
    created_at: datetime | None = None,
) -> tuple[Message, QuestionProposal]:
    proposal = new_proposal([(f"Thema {i}", text) for i, text in enumerate(texts)], None)
    message = Message(
        session_id=session.id,
        role="assistant",
        content="Das sind offene Punkte.",
        agent_name="analyst",
        proposal=proposal_column(proposal),
        **({} if created_at is None else {"created_at": created_at}),
    )
    db_session.add(message)
    await db_session.flush()
    return message, proposal


async def _card_status(db_session: AsyncSession, message: Message) -> str:
    await db_session.refresh(message)
    stored = read_proposal(message.proposal)
    assert stored is not None
    return stored.status


# --- edit_artifact ---


async def test_edit_replaces_the_passage_and_queues_the_highlight(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session, open_artifact=_open(artifact))

    outcome = await toolbox.edit_artifact("01", "take long", "take 3 days", False)

    assert outcome == ToolOutcome(True, "Replaced.")
    assert (await _reload(db_session, artifact)).content == CHANGED_01
    start = CONTENT_01.index("take long")
    assert toolbox.take_events() == [
        (
            "artifact_changed",
            ArtifactChangedEvent(
                artifact_id=artifact.id, start=start, end=start + len("take 3 days")
            ),
        )
    ]
    assert not toolbox.effects.pending


async def test_edit_of_an_artifact_that_is_not_open_opens_it(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.edit_artifact("01", "take long", "take 3 days", False)

    events = toolbox.take_events()
    assert _names(events) == ["artifact_changed", "open_artifact"]
    assert _payload(events, OpenArtifactEvent).artifact_id == artifact.id


async def test_edit_of_another_artifact_clears_the_chip(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    other = await _draft(db_session, project_id, "02", "## Stakeholders\nSomeone.\n")
    chip = await _comment(db_session, other)
    toolbox = _toolbox(
        db_session, run_manager, project_id, session, open_artifact=_open(other, "02"), chip=chip
    )

    outcome = await toolbox.edit_artifact("01", "take long", "take 3 days", False)

    events = toolbox.take_events()
    assert _names(events) == ["artifact_changed", "open_artifact", "chip_cleared"]
    assert _payload(events, OpenArtifactEvent).artifact_id == artifact.id
    assert _payload(events, ChipClearedEvent) == ChipClearedEvent()
    assert outcome == ToolOutcome(True, "Replaced.")
    assert not toolbox.effects.comment_question


async def test_take_events_returns_the_events_once(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session, open_artifact=_open(artifact))

    await toolbox.edit_artifact("01", "take long", "take 3 days", False)

    assert len(toolbox.take_events()) == 1
    assert toolbox.take_events() == []


async def test_edit_is_refused_while_a_run_is_active(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    await _start_run(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.edit_artifact("01", "take long", "take 3 days", False)

    assert outcome == ToolOutcome(False, RUN_ACTIVE)
    assert (await _reload(db_session, artifact)).content == CONTENT_01
    assert toolbox.take_events() == []


async def test_edit_is_refused_while_the_editor_is_open(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session, editor_open=True)

    outcome = await toolbox.edit_artifact("01", "take long", "take 3 days", False)

    assert outcome == ToolOutcome(False, EDITOR_OPEN)
    assert (await _reload(db_session, artifact)).content == CONTENT_01


@pytest.mark.parametrize("content", [None, "  \n"])
async def test_edit_needs_content(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    content: str | None,
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    if content is None:
        await ensure_slots(db_session, project_id)
    else:
        await _draft(db_session, project_id, content=content)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.edit_artifact("01", "x", "y", False)

    assert outcome == ToolOutcome(False, "Artifact 01 has no content yet. Nothing was changed.")
    assert (await get_slot_artifact(db_session, project_id, "01")).content == (content or "")


async def test_a_failed_edit_explains_and_a_third_attempt_gives_up(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id, content=TWO_MATCHES)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    not_found = await toolbox.edit_artifact("01", "missing", "x", False)
    ambiguous = await toolbox.edit_artifact("01", "Offers", "x", False)
    third = await toolbox.edit_artifact("01", "Offers take long.", "x", False)

    assert not_found == ToolOutcome(
        False, "Error: The text to replace was not found. Use the exact text from the artifact."
    )
    assert ambiguous == ToolOutcome(
        False, "Error: The text to replace occurs more than once. Include more context."
    )
    assert third == ToolOutcome(
        False, "Error: giving up. Tell the user the change could not be applied."
    )
    assert (await _reload(db_session, artifact)).content == TWO_MATCHES
    assert toolbox.take_events() == []


async def test_a_successful_edit_does_not_reset_the_failure_count(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.edit_artifact("01", "missing", "x", False)
    assert (await toolbox.edit_artifact("01", "take long", "take 3 days", False)).ok
    await toolbox.edit_artifact("01", "missing", "x", False)
    outcome = await toolbox.edit_artifact("01", "take 3 days", "take 2 days", False)

    assert not outcome.ok
    assert "giving up" in outcome.content


async def test_edit_of_an_approved_artifact_needs_the_users_confirmation(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _approved(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    first = await toolbox.edit_artifact("01", "take long", "take 3 days", False)
    second = await toolbox.edit_artifact("01", "take long", "take 3 days", False)

    assert first == ToolOutcome(False, APPROVED_01)
    assert second == first
    artifact = await _reload(db_session, artifact)
    assert (artifact.status, artifact.content) == ("approved", CONTENT_01)
    assert toolbox.effects.asked_slots == ["01"]
    assert toolbox.effects.pending
    assert toolbox.take_events() == []


async def test_the_revoke_flag_alone_does_not_pass_the_approved_guard(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _approved(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session, confirmable=frozenset({"02"}))

    outcome = await toolbox.edit_artifact("01", "take long", "take 3 days", True)

    assert outcome == ToolOutcome(False, NOT_REGISTERED_01)
    assert (await _reload(db_session, artifact)).status == "approved"
    assert toolbox.effects.asked_slots == ["01"]
    assert toolbox.effects.pending


async def test_a_confirmed_edit_revokes_the_approval(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _approved(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session, confirmable=frozenset({"01"}))

    outcome = await toolbox.edit_artifact("01", "take long", "take 3 days", True)

    assert outcome == ToolOutcome(
        True, "Replaced. The approval was revoked; the artifact is a draft again."
    )
    artifact = await _reload(db_session, artifact)
    assert (artifact.status, artifact.content) == ("draft", CHANGED_01)
    assert not toolbox.effects.pending


async def test_edit_with_a_chip_on_this_artifact_asks_whether_to_resolve_it(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    chip = await _comment(db_session, artifact)
    toolbox = _toolbox(
        db_session, run_manager, project_id, session, open_artifact=_open(artifact), chip=chip
    )

    outcome = await toolbox.edit_artifact("01", "take long", "take 3 days", False)

    assert outcome == ToolOutcome(
        True,
        "Replaced. A comment is attached to this chat ('Unclear scope'). Ask the user whether it "
        "should be marked as resolved, unless they already said so.",
    )
    assert toolbox.effects.comment_question
    assert toolbox.effects.pending
    assert _names(toolbox.take_events()) == ["artifact_changed"]


# --- create_artifact ---


async def test_create_artifact_persists_a_slotless_draft_and_opens_it(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.create_artifact("Meeting notes", "# Notes\n")

    assert outcome.ok
    assert "Meeting notes" in outcome.content
    result = await db_session.execute(
        select(Artifact).where(Artifact.project_id == project_id, Artifact.title == "Meeting notes")
    )
    artifact = result.scalar_one()
    assert artifact.content == "# Notes\n"
    assert artifact.status == "draft"
    assert artifact.type not in {"project_description", "stakeholder_analysis", "open_issues"}
    events = toolbox.take_events()
    assert _names(events) == ["open_artifact"]
    assert _payload(events, OpenArtifactEvent).artifact_id == artifact.id


async def test_create_artifact_defaults_to_empty_content(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.create_artifact("Empty one", "")

    result = await db_session.execute(
        select(Artifact).where(Artifact.project_id == project_id, Artifact.title == "Empty one")
    )
    assert result.scalar_one().content == ""


async def test_create_artifact_is_refused_while_a_run_is_active(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    await _start_run(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.create_artifact("Meeting notes", "")

    assert outcome == ToolOutcome(False, RUN_ACTIVE)
    assert toolbox.take_events() == []


async def test_create_artifact_is_refused_while_the_editor_is_open(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session, editor_open=True)

    outcome = await toolbox.create_artifact("Meeting notes", "")

    assert outcome == ToolOutcome(False, EDITOR_OPEN)
    assert toolbox.take_events() == []


# --- read_artifact ---


async def test_read_of_an_artifact_that_is_not_started(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.read_artifact("02")

    assert outcome == ToolOutcome(True, "Artifact 02 (Stakeholder Analysis) has not been started.")


async def test_read_returns_text_and_status(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    await _approved(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.read_artifact("01")

    assert outcome == ToolOutcome(
        True, f"Artifact 01 (Problem- and Scope-Definition), status approved.\n\n{CONTENT_01}"
    )


async def test_read_lists_the_open_comments_only(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    await _comment(db_session, artifact)
    await _comment(db_session, artifact, status="done_manually", number=2, title="Already done")
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.read_artifact("01")

    assert outcome == ToolOutcome(
        True,
        "Artifact 01 (Problem- and Scope-Definition), status draft.\n\n"
        f"{CONTENT_01}\n\nOpen comments:\n- #1 Unclear scope: The scope is vague.",
    )


# --- start_draft ---


async def test_start_draft_starts_the_run(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_draft("01", False)

    assert outcome == ToolOutcome(
        True,
        "Draft run for 01 (Problem- and Scope-Definition) started. It takes about one to two "
        "minutes and the artifact opens when it is done. Tell the user in one sentence.",
    )
    run_id = _payload(toolbox.take_events(), RunStartedEvent).run_id
    await run_manager.wait(run_id)
    runs = await _runs(db_session, project_id)
    assert [(r.id, r.type, r.slot, r.state) for r in runs] == [(run_id, "draft", "01", "succeeded")]


async def test_start_draft_is_refused_while_a_run_is_active(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    await _start_run(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_draft("01", False)

    assert outcome == ToolOutcome(False, RUN_ACTIVE)
    assert toolbox.take_events() == []
    assert len(await _runs(db_session, project_id)) == 1


async def test_start_draft_is_refused_while_the_editor_is_open(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session, editor_open=True)

    outcome = await toolbox.start_draft("01", False)

    assert outcome == ToolOutcome(False, EDITOR_OPEN)
    assert await _runs(db_session, project_id) == []


async def test_start_draft_of_an_approved_artifact_needs_the_users_confirmation(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    await _approved(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session, confirmable=frozenset({"01"}))

    refused = await toolbox.start_draft("01", False)

    assert refused == ToolOutcome(False, APPROVED_01)
    assert toolbox.effects.asked_slots == ["01"]
    assert await _runs(db_session, project_id) == []

    started = await toolbox.start_draft("01", True)

    assert started.ok
    run_id = _payload(toolbox.take_events(), RunStartedEvent).run_id
    await run_manager.wait(run_id)


async def test_start_draft_with_the_flag_but_without_a_confirmation_is_refused(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    await _approved(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_draft("01", True)

    assert outcome == ToolOutcome(False, NOT_REGISTERED_01)
    assert await _runs(db_session, project_id) == []


async def test_start_draft_notes_a_lower_artifact_that_is_not_approved(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_draft("03", False)

    assert outcome.ok
    assert outcome.content.endswith(
        " Note: 01 is not approved, so the draft relies on the customer documents only."
        " Note: 02 is not approved, so the draft relies on the customer documents only."
    )
    await run_manager.wait(_payload(toolbox.take_events(), RunStartedEvent).run_id)


async def test_start_draft_notes_only_the_lower_artifacts_that_are_missing(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    await _approved(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_draft("03", False)

    assert "Note: 02 is not approved" in outcome.content
    assert "01 is not approved" not in outcome.content
    await run_manager.wait(_payload(toolbox.take_events(), RunStartedEvent).run_id)


async def test_start_draft_has_no_note_when_the_foundation_is_approved(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    await _approved(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_draft("02", False)

    assert "Note" not in outcome.content
    await run_manager.wait(_payload(toolbox.take_events(), RunStartedEvent).run_id)


async def test_the_turn_is_committed_before_the_worker_starts(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The worker reads through its own DB session, so the turn's changes must be durable."""
    run_workers["draft"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    order: list[str] = []
    real_commit = db_session.commit
    real_start = run_manager.start

    async def commit() -> None:
        order.append("commit")
        await real_commit()

    async def start(
        project_id: str, run_type: RunType, slot: Slot, *, language: str | None = None
    ) -> Run:
        order.append("start")
        return await real_start(project_id, run_type, slot, language=language)

    monkeypatch.setattr(db_session, "commit", commit)
    monkeypatch.setattr(run_manager, "start", start)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.start_draft("01", False)

    assert order == ["commit", "start"]
    await run_manager.wait(_payload(toolbox.take_events(), RunStartedEvent).run_id)


async def test_start_draft_reports_a_run_that_cannot_be_started(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_draft("01", False)

    assert outcome == ToolOutcome(False, "The run could not be started.")
    assert toolbox.take_events() == []


# --- start_review ---


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        (None, "There is no draft of 01 to review."),
        ("  \n", "The draft of 01 is empty."),
        (
            CONTENT_01,
            "01 still has open comments. A review is only possible after they are resolved.",
        ),
    ],
)
async def test_start_review_checks_the_preconditions(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
    content: str | None,
    expected: str,
) -> None:
    run_workers["review"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    if content is None:
        await ensure_slots(db_session, project_id)
    else:
        artifact = await _draft(db_session, project_id, content=content)
        if content == CONTENT_01:
            await _comment(db_session, artifact)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_review("01")

    assert outcome == ToolOutcome(False, expected)
    assert toolbox.take_events() == []
    assert await _runs(db_session, project_id) == []


async def test_start_review_starts_the_run(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["review"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_review("01")

    assert outcome == ToolOutcome(
        True,
        "Review of 01 (Problem- and Scope-Definition) started. It takes about one to two "
        "minutes; the comments appear next to the artifact. Tell the user in one sentence.",
    )
    run_id = _payload(toolbox.take_events(), RunStartedEvent).run_id
    await run_manager.wait(run_id)
    runs = await _runs(db_session, project_id)
    assert [(r.id, r.type, r.slot, r.state) for r in runs] == [
        (run_id, "review", "01", "succeeded")
    ]


async def test_start_review_is_refused_while_a_run_is_active(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["review"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    await _draft(db_session, project_id)
    await _start_run(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.start_review("01")

    assert outcome == ToolOutcome(False, RUN_ACTIVE)
    assert len(await _runs(db_session, project_id)) == 1


async def test_start_review_is_refused_while_the_editor_is_open(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    run_workers["review"] = _noop
    project_id, session = await _project_and_session(client, db_session)
    await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session, editor_open=True)

    outcome = await toolbox.start_review("01")

    assert outcome == ToolOutcome(False, EDITOR_OPEN)
    assert await _runs(db_session, project_id) == []


# --- add_workshop_questions ---


async def test_adding_questions_creates_03(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert outcome == ToolOutcome(
        True, "Added 1 question(s) to 03. 03 did not exist yet and was created."
    )
    artifact = await get_slot_artifact(db_session, project_id, "03")
    assert artifact.status == "draft"
    assert artifact.content == f"### Betrieb\n\n**Question:** {QUESTION}\n"
    assert await _question_texts(db_session, project_id) == [QUESTION]
    events = toolbox.take_events()
    assert _names(events) == ["artifact_changed", "open_artifact"]
    changed = _payload(events, ArtifactChangedEvent)
    assert (changed.artifact_id, changed.start) == (artifact.id, 0)
    assert changed.end == len(artifact.content) - 1
    assert _payload(events, OpenArtifactEvent).artifact_id == artifact.id


async def test_adding_questions_from_another_artifact_clears_the_chip(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    chip = await _comment(db_session, artifact)
    toolbox = _toolbox(
        db_session, run_manager, project_id, session, open_artifact=_open(artifact), chip=chip
    )

    await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert _names(toolbox.take_events()) == ["artifact_changed", "open_artifact", "chip_cleared"]
    row = (
        await db_session.execute(
            select(WorkshopQuestion.origin_artifact_id).where(
                WorkshopQuestion.project_id == project_id
            )
        )
    ).scalar_one()
    assert row == artifact.id


async def test_adding_questions_while_03_is_open_only_highlights_them(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    await ensure_slots(db_session, project_id)
    open_issues = await get_slot_artifact(db_session, project_id, "03")
    toolbox = _toolbox(
        db_session, run_manager, project_id, session, open_artifact=_open(open_issues, "03")
    )

    await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert _names(toolbox.take_events()) == ["artifact_changed"]


async def test_adding_questions_appends_to_an_existing_draft(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    existing = f"### Alt\n\n**Question:** {OTHER_QUESTION}\n"
    artifact = await _draft(db_session, project_id, "03", existing)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.add_workshop_questions(
        [("Betrieb", QUESTION), ("Doppelt", OTHER_QUESTION)], False
    )

    assert outcome == ToolOutcome(True, "Added 1 question(s) to 03.")
    artifact = await _reload(db_session, artifact)
    assert artifact.content == f"{existing}\n### Betrieb\n\n**Question:** {QUESTION}\n"
    assert await _question_texts(db_session, project_id) == [QUESTION]


async def test_adding_questions_that_are_already_in_03_changes_nothing(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)
    await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)
    toolbox.take_events()

    outcome = await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert outcome == ToolOutcome(
        True, "All of these questions are already in 03. Nothing was added."
    )
    assert toolbox.take_events() == []
    assert await _question_texts(db_session, project_id) == [QUESTION]


async def test_questions_are_only_listed_while_a_run_is_active(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    await ensure_slots(db_session, project_id)
    await _start_run(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.add_workshop_questions(
        [("Betrieb", QUESTION), ("Systeme", OTHER_QUESTION)], False
    )

    assert outcome == ToolOutcome(
        True,
        "A run is active, so the 2 question(s) were saved to the project's question list only. "
        "Artifact 03 receives them when it is drafted next. Tell the user.",
    )
    assert await _question_texts(db_session, project_id) == sorted([QUESTION, OTHER_QUESTION])
    artifact = await get_slot_artifact(db_session, project_id, "03")
    assert (artifact.status, artifact.content) == ("not_started", "")
    assert toolbox.take_events() == []


async def test_adding_questions_is_refused_while_the_editor_is_open(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session, editor_open=True)

    outcome = await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert outcome == ToolOutcome(False, EDITOR_OPEN)
    assert await _question_texts(db_session, project_id) == []
    assert toolbox.take_events() == []


async def test_adding_questions_to_an_approved_03_needs_the_users_confirmation(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    approved_content = f"### Alt\n\n**Question:** {OTHER_QUESTION}\n"
    artifact = await _approved(db_session, project_id, "03", approved_content)
    toolbox = _toolbox(db_session, run_manager, project_id, session, confirmable=frozenset({"03"}))

    refused = await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert refused.ok is False
    assert refused.content.startswith("Artifact 03 is approved. This would revoke the approval")
    assert toolbox.effects.asked_slots == ["03"]
    assert (await _reload(db_session, artifact)).status == "approved"
    assert await _question_texts(db_session, project_id) == []

    allowed = await toolbox.add_workshop_questions([("Betrieb", QUESTION)], True)

    assert allowed == ToolOutcome(True, "Added 1 question(s) to 03.")
    artifact = await _reload(db_session, artifact)
    assert artifact.status == "draft"
    assert QUESTION in artifact.content


async def test_the_revoke_flag_alone_does_not_pass_the_guard_for_03(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _approved(db_session, project_id, "03", f"**Question:** {OTHER_QUESTION}\n")
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.add_workshop_questions([("Betrieb", QUESTION)], True)

    assert not outcome.ok
    assert outcome.content.startswith(
        "Artifact 03 is approved and the confirmation question was not registered before this call"
    )
    assert (await _reload(db_session, artifact)).status == "approved"
    assert toolbox.effects.asked_slots == ["03"]


async def test_a_run_that_starts_after_the_check_refuses_the_questions(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    await ensure_slots(db_session, project_id)
    await _start_run(db_session, project_id)

    async def no_run_seen(db: AsyncSession, project_id: str) -> None:
        return None

    # The toolbox's own check passes; the check inside the service then finds the run.
    monkeypatch.setattr(chat_toolbox, "get_active_run", no_run_seen)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert outcome == ToolOutcome(False, RUN_ACTIVE)
    assert await _question_texts(db_session, project_id) == []
    artifact = await get_slot_artifact(db_session, project_id, "03")
    assert (artifact.status, artifact.content) == ("not_started", "")
    assert toolbox.take_events() == []


async def test_an_approval_that_appears_after_the_check_asks_for_confirmation(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    await ensure_slots(db_session, project_id)

    async def approved_meanwhile(*args: object, **kwargs: object) -> QuestionAdded:
        raise QuestionBlockedError("approved")

    monkeypatch.setattr(chat_toolbox, "add_questions_to_open_issues", approved_meanwhile)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert not outcome.ok
    assert outcome.content.startswith("Artifact 03 is approved. This would revoke the approval")
    assert toolbox.effects.asked_slots == ["03"]
    assert toolbox.effects.pending
    assert toolbox.take_events() == []


async def test_added_questions_settle_the_open_proposal_card(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    message, proposal = await _card(db_session, session, [QUESTION, OTHER_QUESTION, "Wann?"])
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.add_workshop_questions(
        [("Betrieb", QUESTION), ("Systeme", OTHER_QUESTION)], False
    )

    events = toolbox.take_events()
    assert _names(events) == ["artifact_changed", "open_artifact", "proposal_settled"]
    settled = _payload(events, ProposalSettledEvent)
    assert settled.message_id == message.id
    assert settled.proposal.id == proposal.id
    assert settled.proposal.status == "accepted"
    assert [(q.text, q.state) for q in settled.proposal.questions] == [
        (QUESTION, "accepted"),
        (OTHER_QUESTION, "accepted"),
        ("Wann?", "rejected"),
    ]
    assert await _card_status(db_session, message) == "accepted"


async def test_a_card_without_a_matching_question_stays_open(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    message, _ = await _card(db_session, session, ["Wann?", "Wo?"])
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert _names(toolbox.take_events()) == ["artifact_changed", "open_artifact"]
    assert await _card_status(db_session, message) == "open"


async def test_only_the_newest_open_card_is_settled(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    now = datetime.now(UTC)
    older, _ = await _card(db_session, session, [QUESTION], created_at=now - timedelta(hours=2))
    newest, _ = await _card(db_session, session, [QUESTION], created_at=now - timedelta(hours=1))
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    events = toolbox.take_events()
    assert _payload(events, ProposalSettledEvent).message_id == newest.id
    assert await _card_status(db_session, newest) == "accepted"
    assert await _card_status(db_session, older) == "open"


async def test_a_settled_card_is_not_settled_again(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    message, proposal = await _card(db_session, session, [QUESTION])
    message.proposal = proposal_column(proposal.settled(set()))
    await db_session.flush()
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.add_workshop_questions([("Betrieb", QUESTION)], False)

    assert "proposal_settled" not in _names(toolbox.take_events())
    assert await _card_status(db_session, message) == "rejected"


# --- propose_workshop_questions ---


async def test_proposing_questions_attaches_a_card_and_saves_nothing(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session, open_artifact=_open(artifact))

    outcome = await toolbox.propose_workshop_questions(
        [("Betrieb", QUESTION), ("Systeme", OTHER_QUESTION)]
    )

    assert outcome == ToolOutcome(
        True,
        "A card with the 2 question(s) is shown below your reply; the user chooses there which "
        "ones to add. Do not repeat the questions in your text.",
    )
    proposal = toolbox.effects.proposal
    assert proposal is not None
    assert proposal.origin_artifact_id == artifact.id
    assert proposal.status == "open"
    assert [(q.title, q.text) for q in proposal.questions] == [
        ("Betrieb", QUESTION),
        ("Systeme", OTHER_QUESTION),
    ]
    assert len({q.id for q in proposal.questions}) == 2
    assert not toolbox.effects.pending
    assert toolbox.take_events() == []
    assert await _question_texts(db_session, project_id) == []


async def test_a_second_card_in_the_same_turn_is_refused(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)
    await toolbox.propose_workshop_questions([("Betrieb", QUESTION)])
    first = toolbox.effects.proposal

    outcome = await toolbox.propose_workshop_questions([("Systeme", OTHER_QUESTION)])

    assert outcome == ToolOutcome(False, "A card is already shown for this reply.")
    assert toolbox.effects.proposal is first


# --- resolve_comment ---


async def test_resolving_needs_an_attached_comment(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.resolve_comment()

    assert outcome == ToolOutcome(False, "No comment is attached to this chat.")
    assert toolbox.take_events() == []


async def test_resolving_marks_the_comment_done_and_clears_the_chip(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    chip = await _comment(db_session, artifact)
    toolbox = _toolbox(
        db_session, run_manager, project_id, session, open_artifact=_open(artifact), chip=chip
    )
    await toolbox.edit_artifact("01", "take long", "take 3 days", False)
    assert toolbox.effects.comment_question
    toolbox.take_events()

    outcome = await toolbox.resolve_comment()

    assert outcome == ToolOutcome(True, "Comment 'Unclear scope' is marked as resolved.")
    await db_session.refresh(chip)
    assert chip.status == "done_manually"
    assert toolbox.take_events() == [("chip_cleared", ChipClearedEvent())]
    assert not toolbox.effects.comment_question
    assert not toolbox.effects.pending


async def test_resolving_is_refused_while_a_run_is_active(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    chip = await _comment(db_session, artifact)
    await _start_run(db_session, project_id)
    toolbox = _toolbox(
        db_session, run_manager, project_id, session, open_artifact=_open(artifact), chip=chip
    )

    outcome = await toolbox.resolve_comment()

    assert outcome == ToolOutcome(False, RUN_ACTIVE)
    await db_session.refresh(chip)
    assert chip.status == "open"
    assert toolbox.take_events() == []


async def test_resolving_is_refused_while_the_editor_is_open(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    chip = await _comment(db_session, artifact)
    toolbox = _toolbox(
        db_session,
        run_manager,
        project_id,
        session,
        open_artifact=_open(artifact),
        chip=chip,
        editor_open=True,
    )

    outcome = await toolbox.resolve_comment()

    assert outcome == ToolOutcome(False, EDITOR_OPEN)
    await db_session.refresh(chip)
    assert chip.status == "open"
    assert toolbox.take_events() == []


async def test_a_comment_that_is_already_resolved_is_left_alone(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    chip = await _comment(db_session, artifact)
    chip.status = "rejected"
    await db_session.flush()
    toolbox = _toolbox(
        db_session, run_manager, project_id, session, open_artifact=_open(artifact), chip=chip
    )

    outcome = await toolbox.resolve_comment()

    assert outcome == ToolOutcome(True, "The comment is already resolved.")
    assert chip.status == "rejected"
    assert toolbox.take_events() == []


# --- the specs drive the toolbox ---


async def test_the_tool_specs_drive_the_toolbox(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)
    specs = {spec.name: spec for spec in build_tool_specs(toolbox, with_comment=False)}
    edit = specs["edit_artifact"]

    args = edit.args_model.model_validate_json(
        '{"slot": "01", "find": "take long", "replace": "take 3 days"}'
    )
    outcome = await edit.handler(args)

    assert outcome == ToolOutcome(True, "Replaced.")
    assert (await _reload(db_session, artifact)).content == CHANGED_01
    assert "resolve_comment" not in specs


# --- turn record ---


def test_a_turn_record_round_trips() -> None:
    calls = [ToolCallRecord(name="edit_artifact", arguments={"slot": "01"}, ok=True)]
    transcript: list[dict[str, Any]] = [
        {"role": "assistant", "content": "", "tool_calls": [{"id": "c1"}]},
        {"role": "tool", "tool_call_id": "c1", "name": "edit_artifact", "content": "Replaced."},
    ]

    stored = turn_record(calls, transcript, ["01"])

    assert stored == {
        "calls": [{"name": "edit_artifact", "arguments": {"slot": "01"}, "ok": True}],
        "transcript": transcript,
        "asked_slots": ["01"],
    }
    assert read_turn_record(stored) == ToolCallsRecord(
        calls=calls, transcript=transcript, asked_slots=["01"]
    )


def test_an_empty_turn_has_no_record() -> None:
    assert turn_record([], [], []) is None
    assert turn_record([], [{"role": "assistant", "content": "Hallo"}], []) is not None
    assert turn_record([], [], ["02"]) is not None


def test_reading_nothing_gives_an_empty_record() -> None:
    assert read_turn_record(None) == ToolCallsRecord()


def test_an_old_row_with_only_calls_is_still_readable() -> None:
    old = {"calls": [{"name": "str_replace", "arguments": {"find": "a"}, "ok": False}]}

    record = read_turn_record(old)

    assert record.calls == [ToolCallRecord(name="str_replace", arguments={"find": "a"}, ok=False)]
    assert (record.transcript, record.asked_slots) == ([], [])


# --- rewrite_artifact ---

SECTIONED_01 = "## Problem\n\nOffers take long.\n\n## Scope\n\nSales only.\n"


async def test_rewrite_replaces_a_section_and_queues_the_highlight(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id, content=SECTIONED_01)
    toolbox = _toolbox(db_session, run_manager, project_id, session, open_artifact=_open(artifact))

    outcome = await toolbox.rewrite_artifact("01", "## Problem\n\nSlow offers.", "Problem", False)

    assert outcome == ToolOutcome(True, "Section replaced.")
    content = (await _reload(db_session, artifact)).content
    assert content == "## Problem\n\nSlow offers.\n\n## Scope\n\nSales only.\n"
    assert toolbox.take_events() == [
        (
            "artifact_changed",
            ArtifactChangedEvent(
                artifact_id=artifact.id, start=0, end=len("## Problem\n\nSlow offers.\n\n")
            ),
        )
    ]


async def test_rewrite_without_heading_replaces_the_whole_text(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id, content=SECTIONED_01)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.rewrite_artifact("01", "## Problem\n\nShort.\n", None, False)

    assert outcome == ToolOutcome(True, "Artifact replaced.")
    assert (await _reload(db_session, artifact)).content == "## Problem\n\nShort.\n"
    events = toolbox.take_events()
    assert _names(events) == ["artifact_changed", "open_artifact"]
    changed = _payload(events, ArtifactChangedEvent)
    assert (changed.start, changed.end) == (0, len("## Problem\n\nShort.\n"))


@pytest.mark.parametrize(
    ("content", "heading", "error"),
    [
        (
            SECTIONED_01,
            "Budget",
            "Error: No section with this heading was found. Use the exact heading text from the "
            "artifact.",
        ),
        (
            "## A\n\none\n\n## A\n\ntwo\n",
            "A",
            "Error: More than one section has this heading. Replace the enclosing section "
            "instead.",
        ),
    ],
)
async def test_rewrite_reports_a_heading_it_cannot_resolve(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    content: str,
    heading: str,
    error: str,
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id, content=content)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.rewrite_artifact("01", "new", heading, False)

    assert outcome == ToolOutcome(False, error)
    assert (await _reload(db_session, artifact)).content == content
    assert toolbox.take_events() == []


async def test_rewrite_of_an_approved_artifact_needs_the_confirmation(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _approved(db_session, project_id)
    asking = _toolbox(db_session, run_manager, project_id, session)

    refused = await asking.rewrite_artifact("01", "## Problem\nNew.\n", None, False)

    assert refused == ToolOutcome(False, APPROVED_01)
    assert asking.effects.asked_slots == ["01"]
    assert (await _reload(db_session, artifact)).status == "approved"

    confirmed = _toolbox(
        db_session, run_manager, project_id, session, confirmable=frozenset({"01"})
    )
    outcome = await confirmed.rewrite_artifact("01", "## Problem\nNew.\n", None, True)

    assert outcome == ToolOutcome(
        True, "Artifact replaced. The approval was revoked; the artifact is a draft again."
    )
    reloaded = await _reload(db_session, artifact)
    assert (reloaded.status, reloaded.content) == ("draft", "## Problem\nNew.\n")


async def test_rewrite_of_a_fixed_artifact_without_text_points_to_the_draft_run(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.rewrite_artifact("02", "## Stakeholders\n", None, False)

    assert outcome == ToolOutcome(False, "Artifact 02 has no content yet. Nothing was changed.")


@pytest.mark.parametrize("blocker", ["run", "editor"])
async def test_rewrite_is_refused_while_a_run_is_active_or_the_editor_is_open(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, blocker: str
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    if blocker == "run":
        db_session.add(
            Run(
                id=str(uuid.uuid4()),
                project_id=project_id,
                type="draft",
                slot="02",
                state="running",
            )
        )
        await db_session.flush()
    toolbox = _toolbox(
        db_session, run_manager, project_id, session, editor_open=blocker == "editor"
    )

    outcome = await toolbox.rewrite_artifact("01", "## Problem\nNew.\n", None, False)

    assert outcome == ToolOutcome(False, RUN_ACTIVE if blocker == "run" else EDITOR_OPEN)
    assert (await _reload(db_session, artifact)).content == CONTENT_01


async def test_failed_rewrites_and_edits_share_the_give_up_limit(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.rewrite_artifact("01", "x", "Missing", False)
    await toolbox.edit_artifact("01", "not there", "x", False)
    outcome = await toolbox.rewrite_artifact("01", "## Problem\nNew.\n", None, False)

    assert outcome == ToolOutcome(
        False, "Error: giving up. Tell the user the change could not be applied."
    )


# --- free-form artifacts ---


async def _free(db_session: AsyncSession, toolbox: ChatToolbox, project_id: str) -> Artifact:
    await toolbox.create_artifact("Agenda", "# Agenda\n\n1. Start (10 Min.)\n\nPause: 10 Min.\n")
    toolbox.take_events()
    result = await db_session.execute(
        select(Artifact).where(Artifact.project_id == project_id, Artifact.title == "Agenda")
    )
    return result.scalar_one()


async def test_create_artifact_reports_the_id_the_other_tools_take(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    outcome = await toolbox.create_artifact("Agenda", "# Agenda\n")

    result = await db_session.execute(
        select(Artifact.id).where(Artifact.project_id == project_id, Artifact.title == "Agenda")
    )
    assert f"(id {result.scalar_one()})" in outcome.content


async def test_a_free_artifact_is_read_by_its_id_with_the_users_edits(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)
    artifact = await _free(db_session, toolbox, project_id)
    artifact.content = artifact.content.replace("Pause: 10", "Pause: 20")
    await db_session.flush()

    outcome = await toolbox.read_artifact(artifact.id)

    assert outcome == ToolOutcome(
        True,
        f"Free-form artifact 'Agenda' (id {artifact.id}).\n\n"
        "# Agenda\n\n1. Start (10 Min.)\n\nPause: 20 Min.\n",
    )


async def test_a_free_artifact_is_edited_in_place(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)
    artifact = await _free(db_session, toolbox, project_id)

    outcome = await toolbox.edit_artifact(artifact.id, "Pause: 10 Min.", "Pause: 20 Min.", False)

    assert outcome == ToolOutcome(True, "Replaced.")
    assert "Pause: 20 Min." in (await _reload(db_session, artifact)).content
    events = toolbox.take_events()
    assert _names(events) == ["artifact_changed", "open_artifact"]
    assert _payload(events, ArtifactChangedEvent).artifact_id == artifact.id
    count = await db_session.execute(
        select(Artifact.id).where(Artifact.project_id == project_id, Artifact.title == "Agenda")
    )
    assert len(count.scalars().all()) == 1


async def test_a_free_artifact_is_rewritten_in_place_even_when_empty(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)
    await toolbox.create_artifact("Mail", "")
    result = await db_session.execute(
        select(Artifact).where(Artifact.project_id == project_id, Artifact.title == "Mail")
    )
    artifact = result.scalar_one()

    outcome = await toolbox.rewrite_artifact(artifact.id, "Hallo Frau Petersen,\n", None, False)

    assert outcome == ToolOutcome(True, "Artifact replaced.")
    reloaded = await _reload(db_session, artifact)
    assert (reloaded.content, reloaded.status) == ("Hallo Frau Petersen,\n", "draft")


async def test_an_unknown_or_foreign_artifact_id_is_refused(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    other_id, other_session = await _project_and_session(client, db_session)
    foreign = await _free(
        db_session, _toolbox(db_session, run_manager, other_id, other_session), other_id
    )
    slot_artifact = await _draft(db_session, project_id)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    for ref in ("04", "nope", foreign.id, slot_artifact.id):
        refusal = ToolOutcome(
            False,
            f"There is no artifact '{ref}'. Use 01, 02 or 03, or the id of a free-form artifact "
            "exactly as listed in <state>. Nothing was changed.",
        )
        assert await toolbox.read_artifact(ref) == refusal
        assert await toolbox.edit_artifact(ref, "a", "b", False) == refusal
        assert await toolbox.rewrite_artifact(ref, "x", None, False) == refusal
    assert foreign.content.startswith("# Agenda")


async def test_start_draft_hands_the_language_to_the_run(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    seen: list[str | None] = []

    async def worker(ctx: RunContext) -> None:
        seen.append(ctx.language)

    run_workers["draft"] = worker
    project_id, session = await _project_and_session(client, db_session)
    toolbox = _toolbox(db_session, run_manager, project_id, session)

    await toolbox.start_draft("01", False, "English")
    await run_manager.wait(_payload(toolbox.take_events(), RunStartedEvent).run_id)

    assert seen == ["English"]
