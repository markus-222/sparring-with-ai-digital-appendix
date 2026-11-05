"""LiteLLMClient: request mapping, response parsing, streaming accumulation, errors."""

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import httpx
import litellm.exceptions as litellm_exc
import pytest

from app.infra.litellm_client import LiteLLMClient, translate_error
from app.infra.llm import (
    LLMError,
    LLMRateLimitError,
    LLMRequest,
    LLMUnavailableError,
    LLMUsage,
)


def _client(completion: Any) -> LiteLLMClient:
    return LiteLLMClient(
        model="anthropic/test", api_key="k", api_base="http://x", timeout=5.0, completion=completion
    )


def _tool_call(call_id: str = "c1", name: str = "t", args: str = "{}") -> SimpleNamespace:
    return SimpleNamespace(id=call_id, function=SimpleNamespace(name=name, arguments=args))


@pytest.mark.asyncio
async def test_complete_maps_request_and_parses_text() -> None:
    seen: dict[str, Any] = {}

    async def completion(**kwargs: Any) -> Any:
        seen.update(kwargs)
        message = SimpleNamespace(content="hello", tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    request = LLMRequest(
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=77,
        response_format={"type": "json_object"},
    )
    response = await _client(completion).complete(request)

    assert response.content == "hello"
    assert response.tool_calls == []
    assert seen["model"] == "anthropic/test"
    assert seen["max_tokens"] == 77
    assert seen["timeout"] == 5.0
    assert seen["api_key"] == "k"
    assert seen["api_base"] == "http://x"
    assert seen["response_format"] == {"type": "json_object"}
    assert "tools" not in seen and "tool_choice" not in seen


@pytest.mark.asyncio
async def test_complete_uses_the_request_model_over_the_default() -> None:
    seen: dict[str, Any] = {}

    async def completion(**kwargs: Any) -> Any:
        seen.update(kwargs)
        message = SimpleNamespace(content="hello", tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason="length")])

    request = LLMRequest(messages=[{"role": "user", "content": "hi"}], model="claude-sonnet-5-5")
    response = await _client(completion).complete(request)

    assert seen["model"] == "anthropic/claude-sonnet-5-5"
    assert response.finish_reason == "length"


@pytest.mark.asyncio
async def test_complete_sends_tools_with_default_auto_choice() -> None:
    seen: dict[str, Any] = {}

    async def completion(**kwargs: Any) -> Any:
        seen.update(kwargs)
        message = SimpleNamespace(content=None, tool_calls=[_tool_call("c9", "submit", '{"a": 1}')])
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    tools = [{"type": "function", "function": {"name": "submit"}}]
    response = await _client(completion).complete(
        LLMRequest(messages=[{"role": "user", "content": "x"}], tools=tools)
    )

    assert seen["tools"] == tools
    assert seen["tool_choice"] == "auto"
    assert response.tool_calls == [
        {"id": "c9", "type": "function", "function": {"name": "submit", "arguments": '{"a": 1}'}}
    ]


@pytest.mark.asyncio
async def test_stream_yields_tokens_then_accumulated_tool_calls() -> None:
    def _chunk(content: str | None, tool_calls: list[Any] | None) -> SimpleNamespace:
        delta = SimpleNamespace(content=content, tool_calls=tool_calls)
        return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])

    def _tc(index: int, call_id: str | None, name: str | None, args: str | None) -> SimpleNamespace:
        function = SimpleNamespace(name=name, arguments=args)
        return SimpleNamespace(index=index, id=call_id, function=function)

    async def stream() -> AsyncIterator[Any]:
        yield _chunk("Hel", None)
        yield _chunk("lo", None)
        yield _chunk(None, [_tc(0, "c1", "update", '{"a":')])
        yield _chunk(None, [_tc(0, None, None, " 1}")])

    async def completion(**kwargs: Any) -> Any:
        assert kwargs["stream"] is True
        return stream()

    chunks = [
        c
        async for c in _client(completion).stream(
            LLMRequest(messages=[{"role": "user", "content": "x"}])
        )
    ]

    assert [c.content for c in chunks if c.kind == "token"] == ["Hel", "lo"]
    assert chunks[-1].kind == "tool_calls"
    assert chunks[-1].tool_calls == [
        {"id": "c1", "type": "function", "function": {"name": "update", "arguments": '{"a": 1}'}}
    ]


def _usage(**fields: int | None) -> SimpleNamespace:
    return SimpleNamespace(**fields)


@pytest.mark.asyncio
async def test_complete_maps_usage() -> None:
    async def completion(**kwargs: Any) -> Any:
        message = SimpleNamespace(content="hello", tool_calls=None)
        usage = _usage(
            prompt_tokens=120,
            completion_tokens=15,
            cache_read_input_tokens=100,
            cache_creation_input_tokens=8,
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage)

    response = await _client(completion).complete(LLMRequest(messages=[]))

    assert response.usage == LLMUsage(
        input_tokens=120, output_tokens=15, cache_read_tokens=100, cache_write_tokens=8
    )


@pytest.mark.asyncio
async def test_complete_counts_missing_and_none_usage_fields_as_zero() -> None:
    async def completion(**kwargs: Any) -> Any:
        message = SimpleNamespace(content="hello", tool_calls=None)
        usage = _usage(prompt_tokens=5, completion_tokens=None, cache_read_input_tokens=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage)

    response = await _client(completion).complete(LLMRequest(messages=[]))

    assert response.usage == LLMUsage(input_tokens=5)


@pytest.mark.asyncio
async def test_complete_without_usage_object_leaves_usage_none() -> None:
    async def completion(**kwargs: Any) -> Any:
        message = SimpleNamespace(content="hello", tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    response = await _client(completion).complete(LLMRequest(messages=[]))

    assert response.usage is None


@pytest.mark.asyncio
async def test_stream_requests_usage_and_yields_it_as_the_last_chunk() -> None:
    seen: dict[str, Any] = {}

    def _chunk(content: str | None, tool_calls: list[Any] | None) -> SimpleNamespace:
        delta = SimpleNamespace(content=content, tool_calls=tool_calls)
        return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])

    tool_piece = SimpleNamespace(
        index=0, id="c1", function=SimpleNamespace(name="update", arguments="{}")
    )

    async def stream() -> AsyncIterator[Any]:
        yield _chunk("Hi", None)
        yield _chunk(None, [tool_piece])
        # providers send the totals in a final chunk without choices
        yield SimpleNamespace(
            choices=[],
            usage=_usage(
                prompt_tokens=50,
                completion_tokens=9,
                cache_read_input_tokens=40,
                cache_creation_input_tokens=None,
            ),
        )

    async def completion(**kwargs: Any) -> Any:
        seen.update(kwargs)
        return stream()

    chunks = [
        c
        async for c in _client(completion).stream(
            LLMRequest(messages=[{"role": "user", "content": "x"}])
        )
    ]

    assert seen["stream_options"] == {"include_usage": True}
    assert [c.kind for c in chunks] == ["token", "tool_calls", "usage"]
    assert chunks[-1].usage == LLMUsage(input_tokens=50, output_tokens=9, cache_read_tokens=40)


@pytest.mark.asyncio
async def test_stream_reports_the_last_usage_it_saw() -> None:
    def _chunk(content: str, usage: SimpleNamespace | None) -> SimpleNamespace:
        delta = SimpleNamespace(content=content, tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(delta=delta)], usage=usage)

    async def stream() -> AsyncIterator[Any]:
        yield _chunk("a", _usage(prompt_tokens=10, completion_tokens=1))
        yield _chunk("b", _usage(prompt_tokens=10, completion_tokens=4))

    async def completion(**kwargs: Any) -> Any:
        return stream()

    chunks = [c async for c in _client(completion).stream(LLMRequest(messages=[]))]

    assert chunks[-1].usage == LLMUsage(input_tokens=10, output_tokens=4)


@pytest.mark.asyncio
async def test_stream_without_usage_yields_no_usage_chunk() -> None:
    async def stream() -> AsyncIterator[Any]:
        delta = SimpleNamespace(content="Hi", tool_calls=None)
        yield SimpleNamespace(choices=[SimpleNamespace(delta=delta)])

    async def completion(**kwargs: Any) -> Any:
        return stream()

    chunks = [c async for c in _client(completion).stream(LLMRequest(messages=[]))]

    assert [c.kind for c in chunks] == ["token"]


def test_translate_rate_limit_reads_retry_after() -> None:
    response = httpx.Response(
        429,
        headers={"retry-after": "12"},
        request=httpx.Request("POST", "http://x"),
    )
    exc = litellm_exc.RateLimitError(
        message="slow down", llm_provider="anthropic", model="m", response=response
    )
    translated = translate_error(exc)
    assert isinstance(translated, LLMRateLimitError)
    assert translated.retry_after == 12.0


def test_translate_service_unavailable() -> None:
    exc = litellm_exc.ServiceUnavailableError(message="down", llm_provider="anthropic", model="m")
    assert isinstance(translate_error(exc), LLMUnavailableError)


def test_translate_unknown_error_is_generic() -> None:
    translated = translate_error(ValueError("boom"))
    assert type(translated) is LLMError
    assert "boom" in str(translated)


@pytest.mark.asyncio
async def test_complete_translates_provider_errors() -> None:
    async def completion(**kwargs: Any) -> Any:
        raise litellm_exc.ServiceUnavailableError(
            message="down", llm_provider="anthropic", model="m"
        )

    with pytest.raises(LLMUnavailableError):
        await _client(completion).complete(LLMRequest(messages=[]))


async def test_stream_reports_the_finish_reason_as_the_last_chunk() -> None:
    def _chunk(content: str | None, finish_reason: str | None) -> SimpleNamespace:
        delta = SimpleNamespace(content=content, tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)])

    async def stream() -> AsyncIterator[Any]:
        yield _chunk("Hel", None)
        yield _chunk(None, "length")
        yield SimpleNamespace(choices=[], usage=_usage(prompt_tokens=5, completion_tokens=2))

    async def completion(**kwargs: Any) -> Any:
        return stream()

    chunks = [
        c
        async for c in _client(completion).stream(
            LLMRequest(messages=[{"role": "user", "content": "x"}])
        )
    ]

    assert [c.kind for c in chunks] == ["token", "usage", "finish"]
    assert chunks[-1].finish_reason == "length"
