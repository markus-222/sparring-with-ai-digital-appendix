"""Tests for the LLM port types and the FakeLLM test double."""

import pytest

from app.infra.fake_llm import FakeLLM
from app.infra.llm import LLMRateLimitError, LLMRequest, LLMResponse, LLMUsage


def _req(text: str = "hi") -> LLMRequest:
    return LLMRequest(messages=[{"role": "user", "content": text}])


@pytest.mark.asyncio
async def test_fake_returns_script_in_order_then_default() -> None:
    fake = FakeLLM(["first", LLMResponse(content="second")], default="fallback")
    assert (await fake.complete(_req())).content == "first"
    assert (await fake.complete(_req())).content == "second"
    assert (await fake.complete(_req())).content == "fallback"


@pytest.mark.asyncio
async def test_fake_records_requests() -> None:
    fake = FakeLLM()
    await fake.complete(_req("one"))
    await fake.complete(_req("two"))
    assert [r.messages[0]["content"] for r in fake.requests] == ["one", "two"]


@pytest.mark.asyncio
async def test_fake_raises_scripted_exception() -> None:
    fake = FakeLLM([LLMRateLimitError(retry_after=3.0)])
    with pytest.raises(LLMRateLimitError) as info:
        await fake.complete(_req())
    assert info.value.retry_after == 3.0


@pytest.mark.asyncio
async def test_fake_stream_tokens_join_to_content() -> None:
    fake = FakeLLM(["hello brave new world"])
    chunks = [c async for c in fake.stream(_req())]
    assert all(c.kind == "token" for c in chunks)
    assert "".join(c.content for c in chunks) == "hello brave new world"


@pytest.mark.asyncio
async def test_fake_stream_emits_tool_calls_last() -> None:
    call = {"id": "t1", "type": "function", "function": {"name": "x", "arguments": "{}"}}
    fake = FakeLLM([LLMResponse(content="thinking", tool_calls=[call])])
    chunks = [c async for c in fake.stream(_req())]
    assert chunks[-1].kind == "tool_calls"
    assert chunks[-1].tool_calls == [call]


@pytest.mark.asyncio
async def test_fake_stream_emits_usage_after_tokens_and_tool_calls() -> None:
    call = {"id": "t1", "type": "function", "function": {"name": "x", "arguments": "{}"}}
    usage = LLMUsage(input_tokens=10, output_tokens=3, cache_read_tokens=7)
    fake = FakeLLM([LLMResponse(content="thinking", tool_calls=[call], usage=usage)])
    chunks = [c async for c in fake.stream(_req())]
    assert [c.kind for c in chunks] == ["token", "tool_calls", "usage"]
    assert chunks[-1].usage == usage


@pytest.mark.asyncio
async def test_fake_stream_emits_no_usage_chunk_without_scripted_usage() -> None:
    fake = FakeLLM(["hello"])
    chunks = [c async for c in fake.stream(_req())]
    assert all(c.kind == "token" for c in chunks)


@pytest.mark.asyncio
async def test_fake_enqueue_appends_to_script() -> None:
    fake = FakeLLM(["first"])
    fake.enqueue("second", LLMResponse(content="third"))
    contents = [(await fake.complete(_req())).content for _ in range(3)]
    assert contents == ["first", "second", "third"]
