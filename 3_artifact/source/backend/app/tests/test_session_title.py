"""Chat titles are derived from the first user message. LLM faked."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.fake_llm import FakeLLM
from app.models.session import Session
from app.services.chat_service import ChatService
from app.services.run_manager import RunManager
from app.services.session_title import TITLE_MAX_LENGTH, derive_title
from app.tests.chat_helpers import collect, make_request


def test_short_message_is_kept() -> None:
    assert derive_title("What is Scrum?") == "What is Scrum?"


def test_whitespace_is_collapsed() -> None:
    assert derive_title("  What\n\nis   Scrum?  ") == "What is Scrum?"


def test_blank_message_gives_no_title() -> None:
    assert derive_title(" \n\t ") is None


def test_long_message_is_cut_at_a_word_boundary() -> None:
    title = derive_title("word " * 40)
    assert title is not None
    assert len(title) <= TITLE_MAX_LENGTH
    assert title.endswith("word…")


def test_long_word_without_spaces_is_hard_cut() -> None:
    title = derive_title("x" * 200)
    assert title is not None
    assert len(title) == TITLE_MAX_LENGTH
    assert title.endswith("…")


@pytest.mark.asyncio
async def test_first_message_sets_the_title_and_later_ones_keep_it(
    client: AsyncClient, db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> None:
    project_id = str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])
    resp = await client.post("/api/v1/sessions", json={"project_id": project_id, "title": None})
    session = await db_session.get(Session, str(resp.json()["id"]))
    assert session is not None
    assert session.title is None

    service = ChatService(fake_llm, run_manager)
    fake_llm.enqueue("Paris.")
    await collect(service, db_session, session, make_request(session.id, "Capital of France?"))
    assert session.title == "Capital of France?"

    fake_llm.enqueue("Berlin.")
    await collect(service, db_session, session, make_request(session.id, "And of Germany?"))
    assert session.title == "Capital of France?"
