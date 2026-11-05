"""Review run: check callback, merge/resolve (pure) and the worker (DB).

Test rule: between `start()` and `wait()` do not touch `db_session`/`client`.
Reviewer and Explorer share one LLM and run via `asyncio.gather`, so no test depends on
which agent consumes which scripted reply: every reply is valid for both roles and the
assertions use counts, numbers and suggestion kinds, never the consuming role.
"""

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.fake_llm import FakeLLM
from app.infra.llm import LLMRequest, LLMResponse
from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.document import Document
from app.models.run import Run
from app.schemas.review import (
    BlockEditProposal,
    ProposedComment,
    TextChangeSuggestion,
    WorkshopQuestionSuggestion,
)
from app.schemas.run import RunType, Slot
from app.services.draft_run import store_draft
from app.services.review_run import (
    advisory_check,
    make_check,
    make_review_worker,
    merge_and_resolve,
)
from app.services.run_manager import RunManager, RunWorker
from app.services.slot_service import get_slot_artifact

CONTENT = "## Problem\n\nOffers take long.\n\n## Scope\n\nOffers only."
# Blocks: B1 "## Problem", B2 "Offers take long.", B3 "## Scope", B4 "Offers only."

GOOD_01 = (
    "## Problem\n- Offers take long to prepare [[doc:a.md]]\n\n"
    "## Causes\n- Manual copying [[doc:a.md]]\n\n"
    "## Impact\n- Lost deals [[doc:a.md]]\n\n"
    "## Scope\n- Offer process [[doc:a.md]]"
)
BAD_01 = GOOD_01.replace("## Scope\n- Offer process [[doc:a.md]]", "")
B2_OF_GOOD_01 = "- Offers take long to prepare [[doc:a.md]]"
DRAFT_03 = "### Item\nPoint [[doc:a.md]]\n**Question:** Q?"
CORRECTION_MARKER = "Your submission had problems"


def _reviewer(block: str, title: str = "R") -> ProposedComment:
    return ProposedComment(
        role="reviewer",
        title=title,
        explanation="why",
        suggestion=BlockEditProposal(block_id=block, mode="replace", text="New text."),
    )


def _explorer_edit(block: str, title: str = "E") -> ProposedComment:
    return ProposedComment(
        role="explorer",
        title=title,
        explanation="why",
        suggestion=BlockEditProposal(block_id=block, mode="replace", text="Other text."),
    )


def _explorer_question(title: str = "Q") -> ProposedComment:
    return ProposedComment(
        role="explorer",
        hypothesis=True,
        title=title,
        explanation="why",
        suggestion=WorkshopQuestionSuggestion(text="What is the target?"),
    )


def test_check_accepts_a_resolvable_block_edit() -> None:
    assert make_check("01", CONTENT)(_reviewer("B2")) is None


def test_check_rejects_an_unknown_block_id() -> None:
    message = make_check("01", CONTENT)(_reviewer("B99"))
    assert message is not None and "B99" in message


def test_advisory_check_flags_block_ids_in_user_facing_text() -> None:
    in_explanation = _reviewer("B2").model_copy(update={"explanation": "B2 and B4 conflict."})
    in_title = _reviewer("B2", title="B4 is missing")
    in_question = _explorer_question().model_copy(
        update={"suggestion": WorkshopQuestionSuggestion(text="Does B3 hold?")}
    )
    for proposed in (in_explanation, in_title, in_question):
        message = advisory_check(proposed)
        assert message is not None and "block id" in message


def test_block_ids_in_text_never_make_the_hard_check_fail() -> None:
    proposed = _reviewer("B2").model_copy(update={"explanation": "B2 and B4 conflict."})
    assert make_check("01", CONTENT)(proposed) is None


def test_advisory_check_allows_words_that_merely_look_like_block_ids() -> None:
    proposed = _reviewer("B2").model_copy(update={"explanation": "Plan B2B sales, see ABB1."})
    assert advisory_check(proposed) is None


def test_check_rejects_a_workshop_question_in_slot_03() -> None:
    message = make_check("03", CONTENT)(_explorer_question())
    assert message is not None and "block_edit" in message


def test_check_allows_a_workshop_question_outside_slot_03() -> None:
    assert make_check("01", CONTENT)(_explorer_question()) is None


def test_merge_keeps_the_first_comment_per_block_and_all_questions() -> None:
    merged = merge_and_resolve(
        [
            _reviewer("B2", "first"),
            _explorer_edit("B2", "second"),
            _explorer_question("q1"),
            _explorer_question("q2"),
        ],
        CONTENT,
    )

    assert [c.title for c in merged] == ["first", "q1", "q2"]


def test_merge_turns_block_edits_into_find_replace() -> None:
    (comment,) = merge_and_resolve([_reviewer("B1")], CONTENT)

    assert isinstance(comment.suggestion, TextChangeSuggestion)
    assert comment.suggestion.find == "## Problem"
    assert comment.suggestion.replace == "New text."


# --- DB-backed worker tests ---


def _edit_reply(title: str, block: str = "B2") -> dict[str, object]:
    return {
        "title": title,
        "explanation": "because",
        "suggestion": {"kind": "block_edit", "block_id": block, "mode": "replace", "text": "New."},
    }


def _question_reply(title: str) -> dict[str, object]:
    return {
        "title": title,
        "explanation": "because",
        "hypothesis": True,
        "suggestion": {"kind": "workshop_question", "text": "What is the target?"},
    }


def _submit(*comments: dict[str, object]) -> LLMResponse:
    call = {
        "id": "c1",
        "type": "function",
        "function": {"name": "submit_comments", "arguments": json.dumps({"comments": comments})},
    }
    return LLMResponse(content="", tool_calls=[call])


class _CorrectionAwareLLM(FakeLLM):
    """Answers by request content, not by call order: invalid first, valid after a correction."""

    async def complete(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        if CORRECTION_MARKER in str(request.messages[-1]["content"]):
            return _submit(_edit_reply("Fixed", "B1"))
        return _submit(_question_reply("Not allowed here"))


@pytest.fixture(autouse=True)
def _register_review_worker(run_workers: dict[RunType, RunWorker], fake_llm: FakeLLM) -> None:
    run_workers["review"] = make_review_worker(fake_llm)


async def _seed(client: AsyncClient, db: AsyncSession, slot: Slot, content: str) -> tuple[str, str]:
    project_id = str((await client.post("/api/v1/projects", json={"name": "M"})).json()["id"])
    db.add(
        Document(
            id=str(uuid.uuid4()),
            project_id=project_id,
            filename="a.md",
            content_type="text/markdown",
            size_bytes=6,
            full_text="Text A",
        )
    )
    await db.flush()
    await store_draft(db, project_id, slot, content)
    artifact = await get_slot_artifact(db, project_id, slot)
    await db.commit()
    return project_id, artifact.id


async def _review(manager: RunManager, project_id: str, slot: Slot = "01") -> str:
    run = await manager.start(project_id, "review", slot)
    await manager.wait(run.id)
    return run.id


async def _reload(db: AsyncSession, run_id: str) -> Run:
    result = await db.execute(
        select(Run).where(Run.id == run_id).execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _artifact(db: AsyncSession, artifact_id: str) -> Artifact:
    result = await db.execute(
        select(Artifact).where(Artifact.id == artifact_id).execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _comments(db: AsyncSession, artifact_id: str) -> list[Comment]:
    result = await db.execute(
        select(Comment)
        .where(Comment.artifact_id == artifact_id)
        .order_by(Comment.number)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


def _kinds(comments: list[Comment]) -> list[str]:
    kinds: list[str] = []
    for comment in comments:
        assert comment.suggestion is not None
        kinds.append(str(comment.suggestion["kind"]))
    return sorted(kinds)


def _text_change(comments: list[Comment]) -> TextChangeSuggestion:
    for comment in comments:
        if comment.suggestion is not None and comment.suggestion["kind"] == "text_change":
            return TextChangeSuggestion.model_validate(comment.suggestion)
    raise AssertionError("no text_change comment stored")


def _prompt(llm: FakeLLM, index: int) -> str:
    return str(llm.requests[index].messages[-1]["content"])


@pytest.mark.asyncio
async def test_happy_path_stores_numbered_open_comments(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id, artifact_id = await _seed(client, db_session, "01", GOOD_01)
    fake_llm.enqueue(_submit(_edit_reply("Reword")), _submit(_question_reply("Ask")))

    run_id = await _review(run_manager, project_id)

    run = await _reload(db_session, run_id)
    assert (run.state, run.step, run.error) == ("succeeded", "preparing_comments", None)
    comments = await _comments(db_session, artifact_id)
    assert [c.number for c in comments] == [1, 2]
    assert {c.status for c in comments} == {"open"}
    assert {c.review_number for c in comments} == {1}
    assert _kinds(comments) == ["text_change", "workshop_question"]
    change = _text_change(comments)
    assert change.find == B2_OF_GOOD_01
    assert change.replace == "New."
    assert (await _artifact(db_session, artifact_id)).reviewed_since_change is True


@pytest.mark.asyncio
async def test_an_empty_result_still_marks_the_draft_as_reviewed(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id, artifact_id = await _seed(client, db_session, "01", GOOD_01)
    fake_llm.enqueue(_submit(), _submit())

    run_id = await _review(run_manager, project_id)

    assert (await _reload(db_session, run_id)).state == "succeeded"
    assert await _comments(db_session, artifact_id) == []
    assert (await _artifact(db_session, artifact_id)).reviewed_since_change is True


@pytest.mark.asyncio
async def test_numbering_continues_on_a_second_review(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id, artifact_id = await _seed(client, db_session, "01", GOOD_01)
    db_session.add(
        Comment(
            id=str(uuid.uuid4()),
            artifact_id=artifact_id,
            number=1,
            review_number=1,
            title="Old finding",
            description="d",
            sources=[],
            status="rejected",
        )
    )
    await db_session.commit()
    fake_llm.enqueue(_submit(_edit_reply("New finding")), _submit())

    run_id = await _review(run_manager, project_id)

    assert (await _reload(db_session, run_id)).state == "succeeded"
    comments = await _comments(db_session, artifact_id)
    assert [(c.number, c.review_number, c.status) for c in comments] == [
        (1, 1, "rejected"),
        (2, 2, "open"),
    ]
    assert "<already_resolved>" in _prompt(fake_llm, 0)
    assert "Old finding" in _prompt(fake_llm, 0)


@pytest.mark.asyncio
async def test_two_comments_on_the_same_block_are_merged_into_one(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id, artifact_id = await _seed(client, db_session, "01", GOOD_01)
    fake_llm.enqueue(_submit(_edit_reply("First")), _submit(_edit_reply("Second")))

    run_id = await _review(run_manager, project_id)

    assert (await _reload(db_session, run_id)).state == "succeeded"
    comments = await _comments(db_session, artifact_id)
    assert [c.number for c in comments] == [1]
    assert _kinds(comments) == ["text_change"]


@pytest.mark.asyncio
async def test_the_format_report_is_passed_to_both_agents(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id, _ = await _seed(client, db_session, "01", BAD_01)
    fake_llm.enqueue(_submit(), _submit())

    run_id = await _review(run_manager, project_id)

    assert (await _reload(db_session, run_id)).state == "succeeded"
    assert len(fake_llm.requests) == 2
    assert "missing_heading" in _prompt(fake_llm, 0)
    assert "missing_heading" in _prompt(fake_llm, 1)


@pytest.mark.asyncio
async def test_llm_error_fails_the_run_and_stores_nothing(
    client: AsyncClient, db_session: AsyncSession, run_manager: RunManager, fake_llm: FakeLLM
) -> None:
    project_id, artifact_id = await _seed(client, db_session, "01", GOOD_01)
    fake_llm.enqueue(RuntimeError("boom"))

    run_id = await _review(run_manager, project_id)

    run = await _reload(db_session, run_id)
    assert (run.state, run.error) == ("failed", "RuntimeError")
    assert await _comments(db_session, artifact_id) == []
    assert (await _artifact(db_session, artifact_id)).reviewed_since_change is False


@pytest.mark.asyncio
async def test_slot_03_correction_round_replaces_invalid_workshop_questions(
    client: AsyncClient,
    db_session: AsyncSession,
    run_manager: RunManager,
    run_workers: dict[RunType, RunWorker],
) -> None:
    llm = _CorrectionAwareLLM()
    run_workers["review"] = make_review_worker(llm)
    project_id, artifact_id = await _seed(client, db_session, "03", DRAFT_03)

    run_id = await _review(run_manager, project_id, "03")

    assert (await _reload(db_session, run_id)).state == "succeeded"
    assert len(llm.requests) == 4
    corrections = [r for r in llm.requests if CORRECTION_MARKER in str(r.messages[-1]["content"])]
    assert len(corrections) == 2
    comments = await _comments(db_session, artifact_id)
    assert [c.number for c in comments] == [1]
    assert _kinds(comments) == ["text_change"]
    assert _text_change(comments).find == "### Item"
