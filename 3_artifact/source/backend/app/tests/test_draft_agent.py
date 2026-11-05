"""DraftAgent: one plain completion, fence stripping, blank-answer handling."""

import pytest

from app.agents.draft import DraftAgent, DraftTruncatedError, EmptyDraftError
from app.infra.fake_llm import FakeLLM
from app.infra.llm import LLMResponse


@pytest.mark.asyncio
async def test_write_returns_the_draft_without_a_code_fence() -> None:
    fake = FakeLLM(["```markdown\n## Problem\nText\n```"])

    draft = await DraftAgent(fake).write(inputs='<document name="a.md">x</document>', slot="01")

    assert draft == "## Problem\nText"
    sent = fake.requests[0]
    assert sent.tools is None
    assert '<document name="a.md">x</document>' in sent.messages[-1]["content"]


@pytest.mark.asyncio
async def test_write_in_merge_mode_asks_for_the_complete_merged_artifact() -> None:
    fake = FakeLLM(["## Problem\nMerged"])

    draft = await DraftAgent(fake).write(inputs="IN", slot="01", merge=True)

    assert draft == "## Problem\nMerged"
    user = fake.requests[0].messages[-1]["content"]
    assert "<existing_draft>" in user and "keep every point" in user
    assert "Write the draft of the target artifact now" not in user


@pytest.mark.asyncio
async def test_write_without_merge_asks_for_a_fresh_draft() -> None:
    fake = FakeLLM(["## Problem\nText"])

    await DraftAgent(fake).write(inputs="IN", slot="01")

    user = fake.requests[0].messages[-1]["content"]
    assert "Write the draft of the target artifact now" in user
    assert "keep every point" not in user


@pytest.mark.asyncio
async def test_write_retries_a_cut_off_answer_with_a_larger_budget() -> None:
    cut = LLMResponse(content="", finish_reason="length")
    fake = FakeLLM([cut, "## Problem\nText"])

    draft = await DraftAgent(fake).write(inputs="x", slot="01")

    first, retry = fake.requests
    assert draft == "## Problem\nText"
    assert retry.max_tokens > first.max_tokens
    assert retry.reasoning_effort == "low"
    assert retry.messages == first.messages


@pytest.mark.asyncio
async def test_write_fails_when_the_retry_is_cut_off_too() -> None:
    cut = LLMResponse(content="## Problem\nhalf a sent", finish_reason="length")
    with pytest.raises(DraftTruncatedError):
        await DraftAgent(FakeLLM([cut, cut])).write(inputs="x", slot="01")


@pytest.mark.asyncio
async def test_fix_format_keeps_the_draft_when_the_correction_is_cut_off() -> None:
    cut = LLMResponse(content="## Problem\nhalf", finish_reason="length")

    fixed = await DraftAgent(FakeLLM([cut])).fix_format(
        inputs="x", slot="01", draft="## Full draft", report="r"
    )

    assert fixed == "## Full draft"


@pytest.mark.asyncio
async def test_agent_sends_its_own_model_when_given() -> None:
    fake = FakeLLM(["## Problem\nText"])

    await DraftAgent(fake, "some-model").write(inputs="x", slot="01")

    assert fake.requests[0].model == "some-model"


@pytest.mark.asyncio
async def test_write_caps_thinking_so_text_fits_the_budget() -> None:
    fake = FakeLLM(["## Problem\nText"])

    await DraftAgent(fake).write(inputs="x", slot="01")

    assert fake.requests[0].reasoning_effort == "medium"


@pytest.mark.asyncio
async def test_write_rejects_a_blank_answer() -> None:
    with pytest.raises(EmptyDraftError):
        await DraftAgent(FakeLLM(["   "])).write(inputs="x", slot="01")


@pytest.mark.asyncio
async def test_fix_format_sends_draft_and_report() -> None:
    fake = FakeLLM(["## Problem\nFixed"])

    fixed = await DraftAgent(fake).fix_format(
        inputs="IN", slot="01", draft="## Problem\nBroken", report="- missing_heading: ## Scope"
    )

    assert fixed == "## Problem\nFixed"
    user = fake.requests[0].messages[-1]["content"]
    assert "IN" in user and "## Problem\nBroken" in user and "missing_heading" in user


@pytest.mark.asyncio
async def test_fix_format_keeps_the_original_on_a_blank_answer() -> None:
    fixed = await DraftAgent(FakeLLM([""])).fix_format(
        inputs="x", slot="01", draft="keep me", report="r"
    )

    assert fixed == "keep me"


@pytest.mark.asyncio
async def test_write_sends_only_the_structure_of_the_target_slot() -> None:
    fake = FakeLLM(["x"])

    await DraftAgent(fake).write(inputs="IN", slot="02")

    user = fake.requests[0].messages[-1]["content"]
    assert "<structure>" in user and "## 3. Stakeholder Needs & Concerns" in user
    assert "## 1. Executive Summary" not in user
    assert "## Structure by slot" not in fake.requests[0].messages[0]["content"]


@pytest.mark.asyncio
async def test_fix_format_sends_the_structure() -> None:
    fake = FakeLLM(["x"])

    await DraftAgent(fake).fix_format(inputs="IN", slot="03", draft="d", report="r")

    assert "## 5. Working Assumptions" in fake.requests[0].messages[-1]["content"]


@pytest.mark.asyncio
async def test_write_and_fix_format_name_the_language_when_given() -> None:
    fake = FakeLLM(["## Problem\nText", "## Problem\nFixed"])
    agent = DraftAgent(fake)

    await agent.write(inputs="IN", slot="01", language="English")
    await agent.fix_format(inputs="IN", slot="01", draft="d", report="r", language="English")

    for request in fake.requests:
        assert "<language>English</language>" in request.messages[-1]["content"]


@pytest.mark.asyncio
async def test_write_without_a_language_sends_no_language_block() -> None:
    fake = FakeLLM(["## Problem\nText"])

    await DraftAgent(fake).write(inputs="IN", slot="01")

    assert "<language>" not in fake.requests[0].messages[-1]["content"]
