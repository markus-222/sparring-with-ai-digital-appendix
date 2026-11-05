"""ChatService: one Analyst turn per message - request layout, tool flow, persistence. LLM faked."""

import asyncio
import uuid
from typing import Any, TypeVar

import pytest
from httpx import AsyncClient
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.analyst import AnalystAgent
from app.infra.fake_llm import FakeLLM
from app.infra.llm import LLMRequest, LLMResponse, LLMUnavailableError
from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.document import Document
from app.models.message import Message
from app.models.run import Run
from app.models.session import Session
from app.schemas.chat import (
    ArtifactChangedEvent,
    ChatEvent,
    ChipClearedEvent,
    ErrorEvent,
    OpenArtifactEvent,
    ProposalSettledEvent,
    RunStartedEvent,
    StatusEvent,
)
from app.schemas.proposal import read_proposal
from app.schemas.run import RunType, Slot
from app.schemas.tool_calls import ToolCallsRecord, read_turn_record
from app.services.approval_service import approve_artifact
from app.services.chat_service import ChatService
from app.services.chat_texts import GREETING_NEW
from app.services.draft_run import store_draft
from app.services.run_manager import RunContext, RunManager, RunWorker
from app.services.slot_service import ensure_slots, get_slot_artifact
from app.tests.chat_helpers import collect, done_event, make_request, tool_call, tool_calls

CONTENT_01 = "## Problem\nOffers take long.\n"
CHANGED_01 = "## Problem\nOffers take 3 days.\n"
CONTENT_02 = "## Stakeholders\nSomeone.\n"
CHANGED_TEXT = "Geändert: Angebote dauern jetzt 3 Tage."
EDIT: dict[str, Any] = {"slot": "01", "find": "take long", "replace": "take 3 days"}
MISSED_EDIT: dict[str, Any] = {"slot": "01", "find": "not in the text", "replace": "x"}
QUESTION = "Wer zahlt den Betrieb?"
OTHER_QUESTION = "Welche Systeme sind im Einsatz?"
TOOL_NAMES = [
    "start_draft",
    "start_review",
    "read_artifact",
    "edit_artifact",
    "rewrite_artifact",
    "create_artifact",
    "add_workshop_questions",
    "propose_workshop_questions",
]
INTERRUPTED_NOTE = "Die Antwort wurde unterbrochen. Bitte versuchen Sie es erneut."
ROUND_LIMIT_NOTE = (
    "Ich habe hier abgebrochen, weil zu viele Schritte nötig waren. "
    "Bitte formulieren Sie die Anfrage enger."
)
NEEDS_CONFIRMATION_01 = (
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
RUN_ACTIVE = (
    "A background run is active. Changes are not possible until it has finished; nothing was "
    "changed. Tell the user and ask them to repeat the request afterwards."
)
EDITOR_OPEN = (
    "The user has unsaved edits open in the editor. Nothing was changed. "
    "Ask the user to save or discard them first."
)
_Event = TypeVar("_Event", bound=BaseModel)


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


async def _approved(db_session: AsyncSession, project_id: str) -> Artifact:
    artifact = await _draft(db_session, project_id)
    await approve_artifact(db_session, artifact, force=True)
    return artifact


async def _comment(db_session: AsyncSession, artifact: Artifact) -> Comment:
    comment = Comment(
        artifact_id=artifact.id,
        number=1,
        review_number=1,
        title="Unclear scope",
        description="The scope is vague.",
        sources=[],
        status="open",
        role="reviewer",
    )
    db_session.add(comment)
    await db_session.flush()
    return comment


async def _say(
    service: ChatService,
    db_session: AsyncSession,
    session: Session,
    text: str,
    **kwargs: str | bool | None,
) -> list[ChatEvent]:
    return await collect(service, db_session, session, make_request(session.id, text, **kwargs))


async def _reload(db_session: AsyncSession, artifact: Artifact) -> Artifact:
    await db_session.refresh(artifact)
    return artifact


async def _contents(db_session: AsyncSession, session_id: str, role: str) -> list[str]:
    result = await db_session.execute(
        select(Message.content)
        .where(Message.session_id == session_id, Message.role == role)
        .order_by(Message.created_at)
    )
    return list(result.scalars().all())


async def _record(db_session: AsyncSession, message_id: str) -> ToolCallsRecord:
    message = await db_session.get(Message, message_id)
    assert message is not None
    return read_turn_record(message.tool_calls)


async def _runs(db_session: AsyncSession, project_id: str) -> list[Run]:
    result = await db_session.execute(select(Run).where(Run.project_id == project_id))
    return list(result.scalars().all())


def _names(events: list[ChatEvent]) -> list[str]:
    return [name for name, _ in events]


def _tokens(events: list[ChatEvent]) -> str:
    return "".join(data for name, data in events if name == "token" and isinstance(data, str))


def _payloads(events: list[ChatEvent], kind: type[_Event]) -> list[_Event]:
    return [data for _, data in events if isinstance(data, kind)]


def _turn_text(request: LLMRequest) -> str:
    """The volatile turn block and the user message of an LLM request."""
    return str(request.messages[-1]["content"][0]["text"])


def _offered(request: LLMRequest) -> list[str]:
    return [tool["function"]["name"] for tool in request.tools or []]


def _tool_results(request: LLMRequest) -> list[str]:
    return [m["content"] for m in request.messages if m["role"] == "tool"]


async def test_plain_answer_streams_tokens_and_persists_the_exchange(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    _, session = await _project_and_session(client, db_session)
    answer = "Scrum ist ein agiles Rahmenwerk."
    fake_llm.enqueue(answer)

    events = await _say(ChatService(fake_llm, run_manager), db_session, session, "Was ist Scrum?")

    assert len(fake_llm.requests) == 1
    assert set(_names(events[:-1])) == {"token"}
    assert _tokens(events) == answer
    done = done_event(events)
    assert events[-1] == ("done", done)
    assert (done.content, done.agent, done.label) == (answer, "analyst", "Analyst")
    assert done.pending is False
    assert done.proposal is None
    assert await _contents(db_session, session.id, "user") == ["Was ist Scrum?"]
    reply = await db_session.get(Message, done.message_id)
    assert reply is not None
    assert (reply.role, reply.agent_name, reply.content) == ("assistant", "analyst", answer)
    assert reply.proposal is None
    assert session.title == "Was ist Scrum?"


async def test_the_request_carries_prompt_sources_turn_block_and_tools(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    db_session.add(
        Document(
            id=str(uuid.uuid4()),
            project_id=project_id,
            filename="a.md",
            content_type="text/markdown",
            size_bytes=1,
            full_text="The customer wants faster offers.",
        )
    )
    await db_session.flush()

    await _say(ChatService(fake_llm, run_manager), db_session, session, "What is the goal?")

    request = fake_llm.requests[0]
    system = request.messages[0]
    assert system["role"] == "system"
    assert system["content"] == [
        {"type": "text", "text": AnalystAgent.system_prompt},
        {
            "type": "text",
            "text": '<document name="a.md">\nThe customer wants faster offers.\n</document>',
            "cache_control": {"type": "ephemeral"},
        },
    ]
    assert request.messages[-1]["role"] == "user"
    turn = _turn_text(request)
    assert turn.startswith("<state>\n01 Problem- and Scope-Definition: not_started")
    assert turn.endswith("<user_message>\nWhat is the goal?\n</user_message>")
    assert _offered(request) == TOOL_NAMES
    assert request.max_tokens == 16384


async def test_a_chip_prefixes_the_user_row_and_offers_resolve_comment(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    comment = await _comment(db_session, artifact)
    service = ChatService(fake_llm, run_manager)

    events = await _say(
        service,
        db_session,
        session,
        "Why is this a problem?",
        open_artifact_id=artifact.id,
        comment_id=comment.id,
    )

    assert _payloads(events, ChipClearedEvent) == []
    assert await _contents(db_session, session.id, "user") == [
        "📎 re: Unclear scope\nWhy is this a problem?"
    ]
    assert _offered(fake_llm.requests[0]) == [*TOOL_NAMES, "resolve_comment"]
    assert f'<chip id="{comment.id}">' in _turn_text(fake_llm.requests[0])

    unknown = await _say(
        service,
        db_session,
        session,
        "And now?",
        open_artifact_id=artifact.id,
        comment_id=str(uuid.uuid4()),
    )

    assert unknown[0] == ("chip_cleared", ChipClearedEvent())
    assert (await _contents(db_session, session.id, "user"))[-1] == "And now?"
    assert _offered(fake_llm.requests[1]) == TOOL_NAMES
    assert "<chip" not in _turn_text(fake_llm.requests[1])


async def test_an_edit_changes_the_artifact_and_stores_the_turn(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    fake_llm.enqueue(tool_call("edit_artifact", **EDIT), CHANGED_TEXT)

    events = await _say(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        "Say that offers take 3 days",
        open_artifact_id=artifact.id,
    )

    names = _names(events)
    assert names[:2] == ["status", "artifact_changed"]
    assert set(names[2:-1]) == {"token"}
    assert names[-1] == "done"
    assert events[0] == ("status", StatusEvent(message="Changing the artifact…"))
    assert (await _reload(db_session, artifact)).content == CHANGED_01
    (changed,) = _payloads(events, ArtifactChangedEvent)
    assert changed.artifact_id == artifact.id
    assert CHANGED_01[changed.start : changed.end] == "take 3 days"
    done = done_event(events)
    assert done.content == CHANGED_TEXT
    assert _tokens(events) == CHANGED_TEXT
    assert (done.agent, done.label, done.pending) == ("analyst", "Analyst", False)
    record = await _record(db_session, done.message_id)
    assert [(call.name, call.arguments, call.ok) for call in record.calls] == [
        ("edit_artifact", EDIT, True)
    ]
    assert [message["role"] for message in record.transcript] == ["assistant", "tool", "assistant"]
    assert record.transcript[1]["content"] == "Replaced."
    assert record.transcript[2] == {"role": "assistant", "content": CHANGED_TEXT}
    assert record.asked_slots == []


async def test_the_next_turn_replays_the_tool_calls_of_the_previous_turn(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    service = ChatService(fake_llm, run_manager)
    first_call = tool_call("edit_artifact", **EDIT)
    fake_llm.enqueue(first_call, CHANGED_TEXT, "Gern.")
    await _say(
        service, db_session, session, "Say that offers take 3 days", open_artifact_id=artifact.id
    )

    await _say(service, db_session, session, "Danke", open_artifact_id=artifact.id)

    messages = fake_llm.requests[-1].messages
    assert [message["role"] for message in messages] == [
        "system",
        "assistant",
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
    ]
    assert messages[1] == {"role": "assistant", "content": GREETING_NEW}
    assert messages[2] == {"role": "user", "content": "Say that offers take 3 days"}
    assert messages[3] == {"role": "assistant", "content": "", "tool_calls": first_call.tool_calls}
    assert messages[4] == {
        "role": "tool",
        "tool_call_id": "c1",
        "name": "edit_artifact",
        "content": "Replaced.",
    }
    assert messages[5]["content"][0]["text"] == CHANGED_TEXT
    assert _turn_text(fake_llm.requests[-1]).endswith("<user_message>\nDanke\n</user_message>")


async def test_editing_an_artifact_that_is_not_open_opens_it(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    target = await _draft(db_session, project_id)
    other = await _draft(db_session, project_id, "02", CONTENT_02)
    fake_llm.enqueue(tool_call("edit_artifact", **EDIT), CHANGED_TEXT)

    events = await _say(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        "Say in 01 that offers take 3 days",
        open_artifact_id=other.id,
    )

    assert _names(events)[:3] == ["status", "artifact_changed", "open_artifact"]
    assert _payloads(events, OpenArtifactEvent) == [OpenArtifactEvent(artifact_id=target.id)]
    assert (await _reload(db_session, target)).content == CHANGED_01
    assert (await _reload(db_session, other)).content == CONTENT_02


async def test_the_edit_is_committed_before_its_ui_event_is_sent(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_llm: FakeLLM,
    run_manager: RunManager,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The frontend refetches the artifact on the event, over another connection."""
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    fake_llm.enqueue(tool_call("edit_artifact", **EDIT), CHANGED_TEXT)
    commits = 0
    real_commit = db_session.commit

    async def commit() -> None:
        nonlocal commits
        commits += 1
        await real_commit()

    monkeypatch.setattr(db_session, "commit", commit)
    commits_at_event: list[int] = []

    request = make_request(session.id, "Say that offers take 3 days", open_artifact_id=artifact.id)
    async for name, _ in ChatService(fake_llm, run_manager).stream(db_session, session, request):
        if name == "artifact_changed":
            commits_at_event.append(commits)

    assert commits_at_event == [1]


async def test_changing_an_approved_artifact_takes_a_confirmed_second_turn(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _approved(db_session, project_id)
    service = ChatService(fake_llm, run_manager)
    fake_llm.enqueue(
        tool_call("edit_artifact", **EDIT),
        "01 ist freigegeben. Die Änderung widerruft die Freigabe. Fortfahren?",
    )

    asked = await _say(
        service, db_session, session, "Say that offers take 3 days", open_artifact_id=artifact.id
    )

    assert _payloads(asked, ArtifactChangedEvent) == []
    await _reload(db_session, artifact)
    assert (artifact.content, artifact.status) == (CONTENT_01, "approved")
    asked_done = done_event(asked)
    assert asked_done.pending is True
    record = await _record(db_session, asked_done.message_id)
    assert record.asked_slots == ["01"]
    assert [call.ok for call in record.calls] == [False]

    fake_llm.enqueue(tool_call("edit_artifact", **EDIT, revoke_approval=True), CHANGED_TEXT)
    confirmed = await _say(service, db_session, session, "Ja", open_artifact_id=artifact.id)

    await _reload(db_session, artifact)
    assert (artifact.content, artifact.status) == (CHANGED_01, "draft")
    confirmed_done = done_event(confirmed)
    assert confirmed_done.pending is False
    assert (await _record(db_session, confirmed_done.message_id)).asked_slots == []


async def test_revoke_approval_sent_in_the_first_turn_is_refused_and_registers_the_question(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _approved(db_session, project_id)
    service = ChatService(fake_llm, run_manager)
    fake_llm.enqueue(
        tool_call("edit_artifact", **EDIT, revoke_approval=True),
        "Die Änderung widerruft die Freigabe von 01. Fortfahren?",
    )

    asked = await _say(
        service,
        db_session,
        session,
        "Say that offers take 3 days, I confirm",
        open_artifact_id=artifact.id,
    )

    await _reload(db_session, artifact)
    assert (artifact.content, artifact.status) == (CONTENT_01, "approved")
    assert _tool_results(fake_llm.requests[-1]) == [NOT_REGISTERED_01]
    assert _payloads(asked, ArtifactChangedEvent) == []
    asked_done = done_event(asked)
    assert asked_done.pending is True
    assert (await _record(db_session, asked_done.message_id)).asked_slots == ["01"]

    fake_llm.enqueue(tool_call("edit_artifact", **EDIT, revoke_approval=True), CHANGED_TEXT)
    confirmed = await _say(service, db_session, session, "Ja", open_artifact_id=artifact.id)

    await _reload(db_session, artifact)
    assert (artifact.content, artifact.status) == (CHANGED_01, "draft")
    confirmed_done = done_event(confirmed)
    assert confirmed_done.pending is False
    assert (await _record(db_session, confirmed_done.message_id)).asked_slots == []


async def test_start_draft_starts_one_run_and_reports_a_run_that_is_active(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_llm: FakeLLM,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    release = asyncio.Event()

    async def blocked(ctx: RunContext) -> None:
        await release.wait()

    run_workers["draft"] = blocked
    project_id, session = await _project_and_session(client, db_session)
    service = ChatService(fake_llm, run_manager)
    fake_llm.enqueue(tool_call("start_draft", slot="01"), "Der Entwurf von 01 läuft.")

    events = await _say(service, db_session, session, "Create the first artifact")

    assert _names(events)[:2] == ["status", "run_started"]
    assert events[0] == ("status", StatusEvent(message="Starting the draft…"))
    (started,) = _payloads(events, RunStartedEvent)
    runs = await _runs(db_session, project_id)
    assert [(r.id, r.type, r.slot, r.state) for r in runs] == [
        (started.run_id, "draft", "01", "running")
    ]
    assert done_event(events).agent == "analyst"

    fake_llm.enqueue(tool_call("start_draft", slot="02"), "Es läuft bereits ein Lauf.")
    again = await _say(service, db_session, session, "Create the second one as well")

    assert _payloads(again, RunStartedEvent) == []
    assert _tool_results(fake_llm.requests[-1])[-1] == RUN_ACTIVE
    assert len(await _runs(db_session, project_id)) == 1
    release.set()
    await run_manager.wait(started.run_id)


async def test_proposed_questions_become_a_card_that_adding_them_settles(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    service = ChatService(fake_llm, run_manager)
    questions = [
        {"text": QUESTION, "title": "Betrieb"},
        {"text": OTHER_QUESTION, "title": "Systeme"},
    ]
    fake_llm.enqueue(
        tool_call("propose_workshop_questions", questions=questions), "Hier sind zwei Vorschläge."
    )

    proposed = await _say(service, db_session, session, "Schlagen Sie Workshop-Fragen vor")

    done = done_event(proposed)
    assert done.proposal is not None
    assert [(q.title, q.text) for q in done.proposal.questions] == [
        ("Betrieb", QUESTION),
        ("Systeme", OTHER_QUESTION),
    ]
    assert done.proposal.status == "open"
    assert done.agent == "analyst"
    message = await db_session.get(Message, done.message_id)
    assert message is not None
    assert read_proposal(message.proposal) == done.proposal

    fake_llm.enqueue(
        tool_call("add_workshop_questions", questions=questions), "Beide Fragen stehen in 03."
    )
    added = await _say(service, db_session, session, "Ja, bitte beide aufnehmen")

    (settled,) = _payloads(added, ProposalSettledEvent)
    assert settled.message_id == done.message_id
    assert settled.proposal.status == "accepted"
    assert _names(added)[-1] == "done"
    open_issues = await get_slot_artifact(db_session, project_id, "03")
    assert f"**Question:** {QUESTION}" in open_issues.content
    assert f"**Question:** {OTHER_QUESTION}" in open_issues.content


@pytest.mark.parametrize(
    ("calls", "reply", "expected"),
    [
        ([], "", "Das hat leider nicht geklappt."),
        ([("edit_artifact", EDIT)], "", "Erledigt."),
        ([("edit_artifact", EDIT)], " \n", "Erledigt."),
        (
            [("edit_artifact", EDIT), ("edit_artifact", MISSED_EDIT)],
            "",
            "Das hat leider nicht geklappt.",
        ),
    ],
)
async def test_a_turn_without_text_ends_with_a_fixed_reply(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_llm: FakeLLM,
    run_manager: RunManager,
    calls: list[tuple[str, dict[str, Any]]],
    reply: str,
    expected: str,
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    fake_llm.enqueue(*([tool_calls(*calls)] if calls else []), reply)

    events = await _say(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        "Say that offers take 3 days",
        open_artifact_id=artifact.id,
    )

    done = done_event(events)
    assert done.content == expected
    assert _tokens(events).endswith(expected)
    assert events[-2] == ("token", expected)
    message = await db_session.get(Message, done.message_id)
    assert message is not None
    assert message.content == expected
    record = read_turn_record(message.tool_calls)
    assert len(record.calls) == len(calls)
    assert record.transcript[-1] == {"role": "assistant", "content": expected}
    assert [m["role"] for m in record.transcript].count("assistant") == 1 + bool(calls)


async def test_an_empty_last_round_after_text_stores_no_empty_assistant_message(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    """A replayed transcript must not contain an assistant message without text."""
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    announced = tool_call("edit_artifact", **EDIT).model_copy(
        update={"content": "Geändert: 3 Tage."}
    )
    fake_llm.enqueue(announced, "")

    events = await _say(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        "Say that offers take 3 days",
        open_artifact_id=artifact.id,
    )

    done = done_event(events)
    assert done.content == "Geändert: 3 Tage."
    assert _tokens(events) == "Geändert: 3 Tage."
    record = await _record(db_session, done.message_id)
    assert [m["role"] for m in record.transcript] == ["assistant", "tool"]
    assert record.transcript[0]["content"] == "Geändert: 3 Tage."


async def test_an_llm_failure_before_any_output_is_a_single_error_event(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    _, session = await _project_and_session(client, db_session)
    fake_llm.enqueue(LLMUnavailableError("secret upstream detail"))

    events = await _say(ChatService(fake_llm, run_manager), db_session, session, "Hello")

    assert events == [("error", ErrorEvent(message="LLM call failed"))]
    assert await _contents(db_session, session.id, "user") == ["Hello"]
    assert await _contents(db_session, session.id, "assistant") == [GREETING_NEW]


async def test_an_llm_failure_after_an_edit_keeps_the_turn_with_a_note(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    announced = tool_call("edit_artifact", **EDIT).model_copy(
        update={"content": "Ich passe es an."}
    )
    fake_llm.enqueue(announced, LLMUnavailableError("down"))

    events = await _say(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        "Say that offers take 3 days",
        open_artifact_id=artifact.id,
    )

    assert "error" not in _names(events)
    done = done_event(events)
    assert done.content == f"Ich passe es an.\n\n{INTERRUPTED_NOTE}"
    assert _tokens(events) == done.content
    assert done.agent == "analyst"
    message = await db_session.get(Message, done.message_id)
    assert message is not None
    assert message.content == done.content
    record = read_turn_record(message.tool_calls)
    assert [m["role"] for m in record.transcript] == ["assistant", "tool", "assistant"]
    assert record.transcript[-1] == {"role": "assistant", "content": INTERRUPTED_NOTE}
    assert [call.ok for call in record.calls] == [True]
    assert (await _reload(db_session, artifact)).content == CHANGED_01


async def test_the_round_limit_ends_the_turn_with_a_note(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    forth = tool_call("edit_artifact", slot="01", find="take long", replace="take 3 days")
    back = tool_call("edit_artifact", slot="01", find="take 3 days", replace="take long")
    fake_llm.enqueue(*[forth, back] * 6)

    events = await _say(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        "Keep changing it",
        open_artifact_id=artifact.id,
    )

    assert len(fake_llm.requests) == AnalystAgent.max_rounds == 8
    done = done_event(events)
    assert done.content == ROUND_LIMIT_NOTE
    assert _tokens(events) == ROUND_LIMIT_NOTE
    record = await _record(db_session, done.message_id)
    assert [call.ok for call in record.calls] == [True] * 8
    assert record.transcript[-1] == {"role": "assistant", "content": ROUND_LIMIT_NOTE}
    assert (await _reload(db_session, artifact)).content == CONTENT_01


async def test_an_edit_with_the_editor_open_is_refused_and_the_reply_is_kept(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    artifact = await _draft(db_session, project_id)
    reply = "Bitte speichern oder verwerfen Sie zuerst Ihre Änderungen."
    fake_llm.enqueue(tool_call("edit_artifact", **EDIT), reply)

    events = await _say(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        "Say that offers take 3 days",
        open_artifact_id=artifact.id,
        editor_open=True,
    )

    assert "editor: open (unsaved edits)" in _turn_text(fake_llm.requests[0])
    assert _tool_results(fake_llm.requests[-1]) == [EDITOR_OPEN]
    assert _payloads(events, ArtifactChangedEvent) == []
    assert (await _reload(db_session, artifact)).content == CONTENT_01
    done = done_event(events)
    assert (done.content, done.pending) == (reply, False)
    assert (await _contents(db_session, session.id, "assistant"))[-1] == reply
    assert [call.ok for call in (await _record(db_session, done.message_id)).calls] == [False]


TRUNCATED_NOTE = (
    "Die Antwort war zu lang und wurde abgeschnitten. "
    "Bitte teilen Sie die Anfrage in kleinere Schritte auf."
)


@pytest.mark.parametrize(
    ("reply", "expected"),
    [("", TRUNCATED_NOTE), ("Ich habe", f"Ich habe\n\n{TRUNCATED_NOTE}")],
)
async def test_a_reply_cut_off_at_the_output_limit_says_so(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_llm: FakeLLM,
    run_manager: RunManager,
    reply: str,
    expected: str,
) -> None:
    _, session = await _project_and_session(client, db_session)
    fake_llm.enqueue(LLMResponse(content=reply, finish_reason="length"))

    events = await _say(ChatService(fake_llm, run_manager), db_session, session, "Kürze 03")

    done = done_event(events)
    assert done.content == expected
    assert _tokens(events) == expected
    message = await db_session.get(Message, done.message_id)
    assert message is not None
    assert read_turn_record(message.tool_calls).transcript[-1] == {
        "role": "assistant",
        "content": TRUNCATED_NOTE,
    }


async def test_a_free_artifact_is_revised_in_place_from_the_chat(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session = await _project_and_session(client, db_session)
    mail = Artifact(
        project_id=project_id,
        type="free_abc",
        title="E-Mail",
        content="# Mail\n\nPause: 20 Min.\n",
        status="draft",
    )
    db_session.add(mail)
    await db_session.flush()
    fake_llm.enqueue(
        tool_call(
            "rewrite_artifact", artifact=mail.id, content="# Mail\n\nAgenda\n\nPause: 20 Min.\n"
        ),
        "Geändert: Die Agenda steht jetzt in der Mail.",
    )

    events = await _say(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        "Bitte auch die Agenda aufnehmen",
        open_artifact_id=mail.id,
    )

    turn = _turn_text(fake_llm.requests[0])
    assert f'free-form artifact "E-Mail": id {mail.id}' in turn
    assert f'<open_artifact id="{mail.id}" title="E-Mail" status="free-form">' in turn
    assert "Pause: 20 Min." in turn
    assert done_event(events).content == "Geändert: Die Agenda steht jetzt in der Mail."
    assert (await _reload(db_session, mail)).content == "# Mail\n\nAgenda\n\nPause: 20 Min.\n"
    rows = await db_session.execute(select(Artifact.id).where(Artifact.type.like("free_%")))
    assert rows.scalars().all() == [mail.id]
