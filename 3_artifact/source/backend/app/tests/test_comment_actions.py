"""Comment actions: accept, edit, reject, done manually. DB-backed, no LLM."""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.workshop_question import WorkshopQuestion
from app.schemas.review import TextChangeSuggestion, WorkshopQuestionSuggestion
from app.services.comment_actions import (
    CommentActionError,
    apply_comment,
    mark_done_manually,
    read_suggestion,
    reject_comment,
)
from app.services.draft_run import store_draft
from app.services.slot_service import get_slot_artifact

TEXT: dict[str, Any] = {
    "kind": "text_change",
    "find": "Offers take long.",
    "replace": "Offers take 3 days.",
}
QUESTION: dict[str, Any] = {"kind": "workshop_question", "text": "What is the target?"}
CONTENT = "## Problem\nOffers take long.\n"


async def _project(client: AsyncClient) -> str:
    return str((await client.post("/api/v1/projects", json={"name": "P"})).json()["id"])


async def _setup(
    client: AsyncClient, db_session: AsyncSession, content: str = CONTENT
) -> tuple[str, Artifact]:
    project_id = await _project(client)
    await store_draft(db_session, project_id, "01", content)
    return project_id, await get_slot_artifact(db_session, project_id, "01")


async def _comment(
    db_session: AsyncSession,
    artifact: Artifact,
    suggestion: dict[str, Any] | None,
    status: str = "open",
) -> Comment:
    comment = Comment(
        artifact_id=artifact.id,
        number=1,
        review_number=1,
        title="T",
        description="D",
        sources=[],
        status=status,
        role="reviewer",
        suggestion=suggestion,
    )
    db_session.add(comment)
    await db_session.flush()
    return comment


async def _questions(db_session: AsyncSession, project_id: str) -> list[WorkshopQuestion]:
    result = await db_session.execute(
        select(WorkshopQuestion).where(WorkshopQuestion.project_id == project_id)
    )
    return list(result.scalars().all())


@pytest.mark.asyncio
async def test_accept_text_change_applies_it(client: AsyncClient, db_session: AsyncSession) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    outcome = await apply_comment(db_session, comment)

    assert outcome == "applied"
    assert "Offers take 3 days." in artifact.content
    assert "Offers take long." not in artifact.content
    assert comment.status == "accepted"
    assert comment.suggestion == TEXT


@pytest.mark.asyncio
async def test_accept_workshop_question_adds_it_to_the_list(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, QUESTION)

    outcome = await apply_comment(db_session, comment)

    assert outcome == "question_added"
    questions = await _questions(db_session, project_id)
    assert len(questions) == 1
    assert questions[0].text == "What is the target?"
    assert questions[0].project_id == project_id
    assert questions[0].origin_artifact_id == artifact.id
    assert questions[0].origin_comment_id == comment.id
    assert artifact.content == CONTENT
    assert comment.status == "accepted"


@pytest.mark.asyncio
async def test_edit_text_change_applies_the_edited_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    outcome = await apply_comment(
        db_session,
        comment,
        edited=TextChangeSuggestion(find="Offers take long.", replace="Offers take 2 days."),
    )

    assert outcome == "applied"
    assert "Offers take 2 days." in artifact.content
    assert comment.status == "edited"
    assert comment.suggestion is not None
    assert comment.suggestion["replace"] == "Offers take 2 days."


@pytest.mark.asyncio
async def test_edit_workshop_question_stores_the_edited_text(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, QUESTION)

    outcome = await apply_comment(
        db_session, comment, edited=WorkshopQuestionSuggestion(text="Own wording?")
    )

    assert outcome == "question_added"
    questions = await _questions(db_session, project_id)
    assert [question.text for question in questions] == ["Own wording?"]
    assert comment.status == "edited"
    assert comment.suggestion is not None
    assert comment.suggestion["text"] == "Own wording?"


@pytest.mark.asyncio
async def test_edit_with_the_other_kind_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    project_id, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    with pytest.raises(CommentActionError) as info:
        await apply_comment(
            db_session, comment, edited=WorkshopQuestionSuggestion(text="Own wording?")
        )

    assert info.value.code == "wrong_edit_kind"
    assert comment.status == "open"
    assert comment.suggestion == TEXT
    assert artifact.content == CONTENT
    assert await _questions(db_session, project_id) == []


@pytest.mark.asyncio
async def test_text_change_not_located_leaves_the_comment_open(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    changed = "## Problem\nSomething else entirely.\n"
    _, artifact = await _setup(client, db_session, content=changed)
    comment = await _comment(db_session, artifact, TEXT)

    outcome = await apply_comment(db_session, comment)

    assert outcome == "not_located"
    assert comment.status == "open"
    assert artifact.content == changed

    assert await mark_done_manually(db_session, comment) == "done_manually"
    assert comment.status == "done_manually"


@pytest.mark.asyncio
async def test_ambiguous_find_is_not_located(client: AsyncClient, db_session: AsyncSession) -> None:
    twice = "## Problem\nOffers take long.\nOffers take long.\n"
    _, artifact = await _setup(client, db_session, content=twice)
    comment = await _comment(db_session, artifact, TEXT)

    outcome = await apply_comment(db_session, comment)

    assert outcome == "not_located"
    assert comment.status == "open"
    assert artifact.content == twice


@pytest.mark.asyncio
async def test_reject_changes_nothing_but_the_status(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT)

    outcome = await reject_comment(db_session, comment)

    assert outcome == "rejected"
    assert comment.status == "rejected"
    assert artifact.content == CONTENT


@pytest.mark.asyncio
async def test_resolved_comments_are_read_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, TEXT, status="accepted")

    with pytest.raises(CommentActionError) as apply_info:
        await apply_comment(db_session, comment)
    with pytest.raises(CommentActionError) as reject_info:
        await reject_comment(db_session, comment)
    with pytest.raises(CommentActionError) as done_info:
        await mark_done_manually(db_session, comment)

    assert apply_info.value.code == "not_open"
    assert reject_info.value.code == "not_open"
    assert done_info.value.code == "not_open"
    assert comment.status == "accepted"
    assert artifact.content == CONTENT


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", [{"kind": "bogus"}, None])
async def test_an_invalid_stored_suggestion_is_reported(
    client: AsyncClient, db_session: AsyncSession, raw: dict[str, Any] | None
) -> None:
    _, artifact = await _setup(client, db_session)
    comment = await _comment(db_session, artifact, raw)

    with pytest.raises(CommentActionError) as read_info:
        read_suggestion(comment.suggestion)
    with pytest.raises(CommentActionError) as apply_info:
        await apply_comment(db_session, comment)

    assert read_info.value.code == "invalid_suggestion"
    assert apply_info.value.code == "invalid_suggestion"
    assert comment.status == "open"


@pytest.mark.asyncio
async def test_accept_does_not_touch_reviewed_since_change(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, artifact = await _setup(client, db_session)
    artifact.reviewed_since_change = True
    await db_session.flush()
    comment = await _comment(db_session, artifact, TEXT)

    await apply_comment(db_session, comment)

    assert artifact.reviewed_since_change is True
