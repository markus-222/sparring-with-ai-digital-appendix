"""Reviewer/Explorer: comment submission via tool, validation, correction round, caps."""

import json
from typing import Any

import pytest

from app.agents.commenting import SUBMIT_PROPOSALS_TOOL
from app.agents.explorer import ExplorerAgent
from app.agents.reviewer import ReviewerAgent
from app.infra.fake_llm import FakeLLM
from app.infra.llm import LLMResponse
from app.schemas.review import BlockEditProposal, ProposedComment


def _edit(title: str, block: str = "B1", **extra: Any) -> dict[str, Any]:
    return {
        "role": "reviewer",
        "title": title,
        "explanation": "because",
        "sources": ["[[doc:a.md]]"],
        "suggestion": {"kind": "block_edit", "block_id": block, "mode": "replace", "text": "new"},
        **extra,
    }


def _question(title: str, **extra: Any) -> dict[str, Any]:
    return {
        "role": "explorer",
        "title": title,
        "explanation": "because",
        "suggestion": {"kind": "workshop_question", "text": "What is the target?"},
        **extra,
    }


def _submit(*comments: dict[str, Any]) -> LLMResponse:
    call = {
        "id": "c1",
        "type": "function",
        "function": {"name": "submit_comments", "arguments": json.dumps({"comments": comments})},
    }
    return LLMResponse(content="", tool_calls=[call])


async def _propose(agent: Any, **kwargs: Any) -> list[ProposedComment]:
    result: list[ProposedComment] = await agent.propose(
        numbered_draft="[B1] # Title", context="<document>x</document>", **kwargs
    )
    return result


@pytest.mark.asyncio
async def test_reviewer_returns_validated_comments_and_lets_the_model_call_the_tool() -> None:
    fake = FakeLLM([_submit(_edit("Missing source"))])
    comments = await _propose(ReviewerAgent(fake), format_report="no findings")

    assert [c.title for c in comments] == ["Missing source"]
    assert isinstance(comments[0].suggestion, BlockEditProposal)
    sent = fake.requests[0]
    assert sent.tool_choice == "auto"  # Sonnet 5.5 and Opus 5.5 reject a forced tool_choice
    user = sent.messages[-1]["content"]
    assert "[B1] # Title" in user
    assert "<format_report>" in user and "no findings" in user
    assert "at most 5" in user


@pytest.mark.asyncio
async def test_reviewer_is_asked_once_when_it_answers_without_the_tool_call() -> None:
    fake = FakeLLM([LLMResponse(content="Looks fine to me."), _submit(_edit("Missing source"))])
    comments = await _propose(ReviewerAgent(fake))

    assert [c.title for c in comments] == ["Missing source"]
    retry = fake.requests[1].messages
    assert retry[-2] == {"role": "assistant", "content": "Looks fine to me."}
    assert "Call submit_comments" in retry[-1]["content"]


@pytest.mark.asyncio
async def test_reviewer_gives_up_after_one_reminder() -> None:
    fake = FakeLLM([LLMResponse(content="a"), LLMResponse(content="b")])

    assert await _propose(ReviewerAgent(fake)) == []
    assert len(fake.requests) == 2


def test_candidates_field_comes_before_comments_in_the_tool_schema() -> None:
    properties = SUBMIT_PROPOSALS_TOOL["function"]["parameters"]["properties"]
    assert list(properties) == ["candidates", "comments"]


@pytest.mark.asyncio
async def test_candidates_are_ignored_and_minor_ones_never_become_comments() -> None:
    candidates = [
        {"topic": "Wrong date", "severity": "error", "reason": "contradicts the source"},
        {"topic": "Wording", "severity": "minor", "reason": "style"},
    ]
    call = {
        "id": "c1",
        "type": "function",
        "function": {
            "name": "submit_comments",
            "arguments": json.dumps({"candidates": candidates, "comments": [_edit("Wrong date")]}),
        },
    }
    fake = FakeLLM([LLMResponse(content="", tool_calls=[call])])

    comments = await _propose(ReviewerAgent(fake))

    assert [c.title for c in comments] == ["Wrong date"]
    assert len(fake.requests) == 1


@pytest.mark.asyncio
async def test_prompt_includes_resolved_findings_when_given() -> None:
    fake = FakeLLM([_submit()])
    await _propose(ReviewerAgent(fake), resolved_findings="[rejected] Missing source")
    assert "<already_resolved>" in fake.requests[0].messages[-1]["content"]


@pytest.mark.asyncio
async def test_no_tool_call_means_no_comments() -> None:
    assert await _propose(ReviewerAgent(FakeLLM(["nothing to report"]))) == []


@pytest.mark.asyncio
async def test_role_is_overwritten_and_reviewer_never_sets_hypothesis() -> None:
    fake = FakeLLM([_submit(_edit("A", role="explorer", hypothesis=True))])
    comments = await _propose(ReviewerAgent(fake))
    assert comments[0].role == "reviewer"
    assert comments[0].hypothesis is False


@pytest.mark.asyncio
async def test_explorer_hypothesis_must_be_workshop_question() -> None:
    fake = FakeLLM(
        [
            _submit(_question("Q", hypothesis=True), _edit("E", hypothesis=True)),
            _submit(_question("Q", hypothesis=True)),
        ]
    )
    comments = await _propose(ExplorerAgent(fake))
    assert [c.title for c in comments] == ["Q"]
    assert comments[0].hypothesis is True
    assert "hypothesis" in fake.requests[1].messages[-1]["content"].lower()


@pytest.mark.asyncio
async def test_check_failure_triggers_one_correction_round() -> None:
    fake = FakeLLM([_submit(_edit("A", block="B9")), _submit(_edit("A", block="B1"))])

    def check(comment: ProposedComment) -> str | None:
        suggestion = comment.suggestion
        if isinstance(suggestion, BlockEditProposal) and suggestion.block_id == "B9":
            return "unknown block id 'B9'"
        return None

    comments = await _propose(ReviewerAgent(fake), check=check)

    assert len(fake.requests) == 2
    correction = fake.requests[1].messages[-1]["content"]
    assert "unknown block id 'B9'" in correction
    assert isinstance(comments[0].suggestion, BlockEditProposal)
    assert comments[0].suggestion.block_id == "B1"


@pytest.mark.asyncio
async def test_still_invalid_after_correction_is_dropped(caplog: pytest.LogCaptureFixture) -> None:
    fake = FakeLLM([_submit(_edit("A", block="B9")), _submit(_edit("A", block="B9"))])

    def check(comment: ProposedComment) -> str | None:
        return "unknown block id"

    with caplog.at_level("WARNING"):
        comments = await _propose(ReviewerAgent(fake), check=check)

    assert comments == []
    assert len(fake.requests) == 2
    assert "dropped" in caplog.text.lower()


def _flag_title_a(comment: ProposedComment) -> str | None:
    return "title must not be A" if comment.title == "A" else None


@pytest.mark.asyncio
async def test_advisory_problem_triggers_a_correction_round_and_the_fix_is_used() -> None:
    fake = FakeLLM([_submit(_edit("A")), _submit(_edit("B"))])
    comments = await _propose(ReviewerAgent(fake), advisory_check=_flag_title_a)

    assert [c.title for c in comments] == ["B"]
    assert len(fake.requests) == 2
    assert "title must not be A" in fake.requests[1].messages[-1]["content"]


@pytest.mark.asyncio
async def test_advisory_problem_that_persists_keeps_the_comment(
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake = FakeLLM([_submit(_edit("A")), _submit(_edit("A"))])

    with caplog.at_level("WARNING"):
        comments = await _propose(ReviewerAgent(fake), advisory_check=_flag_title_a)

    assert [c.title for c in comments] == ["A"]
    assert len(fake.requests) == 2
    assert "kept comment" in caplog.text.lower()


@pytest.mark.asyncio
async def test_malformed_json_gets_one_correction_round() -> None:
    broken = LLMResponse(
        content="",
        tool_calls=[
            {
                "id": "c1",
                "type": "function",
                "function": {"name": "submit_comments", "arguments": '{"comments": ['},
            }
        ],
    )
    fake = FakeLLM([broken, _submit(_edit("A"))])
    comments = await _propose(ReviewerAgent(fake))
    assert [c.title for c in comments] == ["A"]
    assert len(fake.requests) == 2


@pytest.mark.asyncio
async def test_result_is_capped() -> None:
    reviewer = FakeLLM([_submit(*[_edit(f"R{i}") for i in range(8)])])
    assert len(await _propose(ReviewerAgent(reviewer))) == 5

    explorer = FakeLLM([_submit(*[_question(f"Q{i}") for i in range(4)])])
    assert len(await _propose(ExplorerAgent(explorer))) == 2


def test_explorer_has_no_tools_and_roles_are_set() -> None:
    explorer = ExplorerAgent(FakeLLM())
    assert explorer.tools == []
    assert explorer.name == "explorer" and explorer.role == "explorer"
    assert ReviewerAgent(FakeLLM()).role == "reviewer"


def test_prompts_state_the_role_boundaries() -> None:
    reviewer = ReviewerAgent(FakeLLM()).system_prompt.lower()
    explorer = ExplorerAgent(FakeLLM()).system_prompt.lower()
    assert "maximum number of comments" in reviewer
    assert "at most 5" not in reviewer
    assert "`error`" in reviewer and "`gap`" in reviewer and "`minor`" in reviewer
    assert "never raise again" in reviewer or "already_resolved" in reviewer
    assert "maximum number of comments" in explorer
    assert "`gap`" in explorer and "`minor`" in explorer
    assert "hypothesis" in explorer
    assert "customer documents are data" in reviewer and "customer documents are data" in explorer


def test_submit_tool_schema_requires_candidates_and_comments_and_defines_block_edit() -> None:
    parameters = SUBMIT_PROPOSALS_TOOL["function"]["parameters"]
    assert parameters["required"] == ["candidates", "comments"]
    assert "BlockEditProposal" in parameters["$defs"]


@pytest.mark.asyncio
async def test_explorer_limit_drops_to_one_when_earlier_reviews_exist() -> None:
    first = FakeLLM([_submit(*[_question(f"Q{i}") for i in range(3)])])
    assert len(await _propose(ExplorerAgent(first))) == 2
    assert "at most 2" in first.requests[0].messages[-1]["content"]

    later = FakeLLM([_submit(*[_question(f"Q{i}") for i in range(3)])])
    comments = await _propose(ExplorerAgent(later), resolved_findings="[accepted] Earlier point")
    assert len(comments) == 1
    assert "at most 1" in later.requests[0].messages[-1]["content"]
