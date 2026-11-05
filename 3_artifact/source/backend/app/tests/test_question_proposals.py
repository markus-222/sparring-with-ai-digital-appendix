"""Question proposal cards: persisted on the message, resolved by the endpoint (idempotent)."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.fake_llm import FakeLLM
from app.models.message import Message
from app.models.run import Run
from app.models.session import Session
from app.models.workshop_question import WorkshopQuestion
from app.schemas.proposal import QuestionProposal, read_proposal
from app.services.approval_service import approve_artifact
from app.services.chat_service import ChatService
from app.services.draft_run import store_draft
from app.services.run_manager import RunManager
from app.services.slot_service import get_slot_artifact
from app.tests.chat_helpers import collect, done_event, make_request, tool_call


async def _offer(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_llm: FakeLLM,
    run_manager: RunManager,
) -> tuple[str, Session, str, QuestionProposal]:
    project_id = str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id, "title": None})
    session = await db_session.get(Session, str(resp.json()["id"]))
    assert session is not None
    questions = [
        {"text": "a?", "title": "A"},
        {"text": "b?", "title": "B"},
        {"text": "c?", "title": "C"},
    ]
    fake_llm.enqueue(
        tool_call("propose_workshop_questions", questions=questions), "Drei Punkte sind offen."
    )
    events = await collect(
        ChatService(fake_llm, run_manager),
        db_session,
        session,
        make_request(session.id, "Was ist offen?"),
    )
    done = done_event(events)
    assert done.proposal is not None
    return project_id, session, done.message_id, done.proposal


def _url(session: Session, message_id: str) -> str:
    return f"/api/v1/sessions/{session.id}/proposals/{message_id}/resolve"


@pytest.mark.asyncio
async def test_the_offer_is_stored_on_the_message_and_returned_by_the_session(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    _, session, message_id, proposal = await _offer(client, db_session, fake_llm, run_manager)

    body = (await client.get(f"/api/v1/sessions/{session.id}")).json()

    stored = next(m for m in body["messages"] if m["id"] == message_id)
    assert stored["proposal"]["id"] == proposal.id
    assert [q["text"] for q in stored["proposal"]["questions"]] == ["a?", "b?", "c?"]
    assert stored["proposal"]["status"] == "open"
    assert "a?" not in stored["content"]


@pytest.mark.asyncio
async def test_accepting_a_selection_adds_only_those_questions_and_settles_the_card(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session, message_id, proposal = await _offer(
        client, db_session, fake_llm, run_manager
    )
    chosen = [proposal.questions[0].id, proposal.questions[2].id]

    resp = await client.post(
        _url(session, message_id), json={"action": "accept", "question_ids": chosen}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["proposal"]["status"] == "accepted"
    assert [q["state"] for q in body["proposal"]["questions"]] == [
        "accepted",
        "rejected",
        "accepted",
    ]
    assert body["reply"]["content"] == (
        "2 Fragen wurden zu 03 hinzugefügt. Da 03 noch nicht existierte, habe ich es angelegt."
    )
    artifact = await get_slot_artifact(db_session, project_id, "03")
    assert body["artifact_id"] == artifact.id
    assert "**Question:** a?" in artifact.content
    assert "**Question:** b?" not in artifact.content
    assert "**Question:** c?" in artifact.content


@pytest.mark.asyncio
async def test_accepting_twice_is_idempotent(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    _, session, message_id, proposal = await _offer(client, db_session, fake_llm, run_manager)
    payload = {"action": "accept", "question_ids": [proposal.questions[0].id]}
    await client.post(_url(session, message_id), json=payload)

    again = await client.post(_url(session, message_id), json=payload)

    assert again.status_code == 200
    assert again.json()["proposal"]["status"] == "accepted"
    assert again.json()["reply"] is None
    saved = (await db_session.execute(select(WorkshopQuestion))).scalars().all()
    assert [q.text for q in saved] == ["a?"]


@pytest.mark.asyncio
async def test_rejecting_settles_the_card_and_adds_nothing(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session, message_id, _ = await _offer(client, db_session, fake_llm, run_manager)

    resp = await client.post(_url(session, message_id), json={"action": "reject"})

    assert resp.status_code == 200
    assert resp.json()["proposal"]["status"] == "rejected"
    assert (await get_slot_artifact(db_session, project_id, "03")).status == "not_started"
    stored = await db_session.get(Message, message_id)
    assert stored is not None
    card = read_proposal(stored.proposal)
    assert card is not None and card.status == "rejected"


@pytest.mark.asyncio
async def test_an_empty_or_unknown_selection_is_a_conflict(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    _, session, message_id, _ = await _offer(client, db_session, fake_llm, run_manager)

    empty = await client.post(_url(session, message_id), json={"action": "accept"})
    unknown = await client.post(
        _url(session, message_id), json={"action": "accept", "question_ids": ["nope"]}
    )

    assert empty.status_code == 409
    assert empty.json()["detail"]["code"] == "no_selection"
    assert unknown.status_code == 409
    assert unknown.json()["detail"]["code"] == "unknown_question"


@pytest.mark.asyncio
async def test_an_approved_03_needs_a_revoke_and_keeps_the_card_open(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session, message_id, proposal = await _offer(
        client, db_session, fake_llm, run_manager
    )
    await store_draft(db_session, project_id, "03", "## T\n\n### Q\nx\n")
    await approve_artifact(
        db_session, await get_slot_artifact(db_session, project_id, "03"), force=True
    )
    payload = {"action": "accept", "question_ids": [proposal.questions[0].id]}

    blocked = await client.post(_url(session, message_id), json=payload)
    revoked = await client.post(_url(session, message_id), json={**payload, "revoke": True})

    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "needs_revoke"
    assert revoked.status_code == 200
    assert revoked.json()["proposal"]["status"] == "accepted"
    assert (await get_slot_artifact(db_session, project_id, "03")).status == "draft"


@pytest.mark.asyncio
async def test_an_active_run_blocks_accepting(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id, session, message_id, proposal = await _offer(
        client, db_session, fake_llm, run_manager
    )
    db_session.add(Run(project_id=project_id, type="draft", slot="01", state="running"))
    await db_session.flush()

    resp = await client.post(
        _url(session, message_id),
        json={"action": "accept", "question_ids": [proposal.questions[0].id]},
    )

    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "run_active"
    stored = await db_session.get(Message, message_id)
    assert stored is not None
    card = read_proposal(stored.proposal)
    assert card is not None and card.status == "open"


@pytest.mark.asyncio
async def test_a_message_without_a_card_or_of_a_foreign_session_is_404(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    _, session, _, _ = await _offer(client, db_session, fake_llm, run_manager)
    plain = (
        (
            await db_session.execute(
                select(Message).where(Message.session_id == session.id, Message.proposal.is_(None))
            )
        )
        .scalars()
        .first()
    )
    assert plain is not None

    missing_card = await client.post(_url(session, plain.id), json={"action": "reject"})
    missing_session = await client.post(
        f"/api/v1/sessions/nope/proposals/{plain.id}/resolve", json={"action": "reject"}
    )

    assert missing_card.status_code == 404
    assert missing_session.status_code == 404
