"""ResilientLLM: concurrency cap, retry/backoff, Retry-After, timeouts."""

import asyncio
from collections.abc import AsyncIterator

import pytest

from app.infra.fake_llm import FakeLLM
from app.infra.llm import (
    LLMClient,
    LLMError,
    LLMRateLimitError,
    LLMRequest,
    LLMResponse,
    LLMStreamChunk,
    LLMTimeoutError,
    LLMUnavailableError,
)
from app.infra.resilient import ResilientLLM


def _req() -> LLMRequest:
    return LLMRequest(messages=[{"role": "user", "content": "hi"}])


def _wrap(
    inner: LLMClient,
    *,
    max_concurrency: int = 2,
    max_retries: int = 2,
    call_timeout: float = 1.0,
    stream_idle_timeout: float = 1.0,
) -> tuple[ResilientLLM, list[float]]:
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    client = ResilientLLM(
        inner,
        max_concurrency=max_concurrency,
        max_retries=max_retries,
        base_delay=1.0,
        max_delay=10.0,
        call_timeout=call_timeout,
        stream_idle_timeout=stream_idle_timeout,
        sleep=fake_sleep,
        jitter=lambda: 1.0,
    )
    return client, sleeps


@pytest.mark.asyncio
async def test_retries_429_with_exponential_backoff() -> None:
    fake = FakeLLM([LLMRateLimitError(), LLMUnavailableError(), "done"])
    client, sleeps = _wrap(fake)
    assert (await client.complete(_req())).content == "done"
    assert sleeps == [1.0, 2.0]
    assert len(fake.requests) == 3


@pytest.mark.asyncio
async def test_respects_retry_after() -> None:
    fake = FakeLLM([LLMRateLimitError(retry_after=7.0), "done"])
    client, sleeps = _wrap(fake)
    await client.complete(_req())
    assert sleeps == [7.0]


@pytest.mark.asyncio
async def test_jitter_scales_delay() -> None:
    fake = FakeLLM([LLMUnavailableError(), "done"])
    sleeps: list[float] = []

    async def fake_sleep(delay: float) -> None:
        sleeps.append(delay)

    client = ResilientLLM(
        fake,
        max_concurrency=1,
        max_retries=1,
        base_delay=4.0,
        max_delay=10.0,
        call_timeout=1.0,
        stream_idle_timeout=1.0,
        sleep=fake_sleep,
        jitter=lambda: 0.0,
    )
    await client.complete(_req())
    assert sleeps == [2.0]


@pytest.mark.asyncio
async def test_gives_up_after_max_retries() -> None:
    fake = FakeLLM([LLMUnavailableError()] * 3)
    client, _ = _wrap(fake, max_retries=2)
    with pytest.raises(LLMUnavailableError):
        await client.complete(_req())
    assert len(fake.requests) == 3


@pytest.mark.asyncio
async def test_does_not_retry_other_errors() -> None:
    fake = FakeLLM([LLMError("bad request"), "never"])
    client, sleeps = _wrap(fake)
    with pytest.raises(LLMError):
        await client.complete(_req())
    assert sleeps == []
    assert len(fake.requests) == 1


class _SlowLLM:
    async def complete(self, request: LLMRequest) -> LLMResponse:
        await asyncio.sleep(5)
        return LLMResponse(content="late")

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        return self._stream()

    async def _stream(self) -> AsyncIterator[LLMStreamChunk]:
        await asyncio.sleep(5)
        yield LLMStreamChunk(kind="token", content="late")


@pytest.mark.asyncio
async def test_call_timeout_raises_and_is_not_retried() -> None:
    client, sleeps = _wrap(_SlowLLM(), call_timeout=0.05)
    with pytest.raises(LLMTimeoutError):
        await client.complete(_req())
    assert sleeps == []


@pytest.mark.asyncio
async def test_stream_idle_timeout() -> None:
    client, _ = _wrap(_SlowLLM(), stream_idle_timeout=0.05)
    with pytest.raises(LLMTimeoutError):
        _ = [c async for c in client.stream(_req())]


class _TrackingLLM:
    def __init__(self) -> None:
        self.in_flight = 0
        self.peak = 0

    async def complete(self, request: LLMRequest) -> LLMResponse:
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        await asyncio.sleep(0.02)
        self.in_flight -= 1
        return LLMResponse(content="ok")

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        raise NotImplementedError


@pytest.mark.asyncio
async def test_concurrency_is_capped() -> None:
    tracker = _TrackingLLM()
    client, _ = _wrap(tracker, max_concurrency=2)
    await asyncio.gather(*(client.complete(_req()) for _ in range(6)))
    assert tracker.peak == 2


@pytest.mark.asyncio
async def test_stream_retries_before_first_chunk() -> None:
    fake = FakeLLM([LLMRateLimitError(), "hello world"])
    client, sleeps = _wrap(fake)
    chunks = [c async for c in client.stream(_req())]
    assert "".join(c.content for c in chunks) == "hello world"
    assert sleeps == [1.0]


class _FailsMidStream:
    def __init__(self) -> None:
        self.calls = 0

    async def complete(self, request: LLMRequest) -> LLMResponse:
        raise NotImplementedError

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        self.calls += 1
        return self._stream()

    async def _stream(self) -> AsyncIterator[LLMStreamChunk]:
        yield LLMStreamChunk(kind="token", content="partial")
        raise LLMUnavailableError("dropped")


@pytest.mark.asyncio
async def test_stream_does_not_retry_after_first_chunk() -> None:
    inner = _FailsMidStream()
    client, sleeps = _wrap(inner)
    seen: list[str] = []
    with pytest.raises(LLMUnavailableError):
        async for chunk in client.stream(_req()):
            seen.append(chunk.content)
    assert seen == ["partial"]
    assert inner.calls == 1
    assert sleeps == []
