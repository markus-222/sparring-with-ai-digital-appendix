"""Runtime resilience around any LLMClient: concurrency cap, retry, timeouts."""

import asyncio
import random
from collections.abc import AsyncIterator, Awaitable, Callable

from app.infra.llm import (
    LLMClient,
    LLMRateLimitError,
    LLMRequest,
    LLMResponse,
    LLMStreamChunk,
    LLMTimeoutError,
    LLMUnavailableError,
)

_RETRYABLE = (LLMRateLimitError, LLMUnavailableError)


class ResilientLLM:
    def __init__(
        self,
        inner: LLMClient,
        *,
        max_concurrency: int,
        max_retries: int,
        base_delay: float,
        max_delay: float,
        call_timeout: float,
        stream_idle_timeout: float,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        jitter: Callable[[], float] = random.random,
    ) -> None:
        self._inner = inner
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._max_retries = max_retries
        self._base_delay = base_delay
        self._max_delay = max_delay
        self._call_timeout = call_timeout
        self._stream_idle_timeout = stream_idle_timeout
        self._sleep = sleep
        self._jitter = jitter

    def _delay(self, attempt: int, error: LLMRateLimitError | LLMUnavailableError) -> float:
        if isinstance(error, LLMRateLimitError) and error.retry_after is not None:
            return error.retry_after
        backoff: float = min(self._max_delay, self._base_delay * 2**attempt)
        return backoff * (0.5 + 0.5 * self._jitter())

    async def complete(self, request: LLMRequest) -> LLMResponse:
        attempt = 0
        while True:
            try:
                async with self._semaphore:
                    return await asyncio.wait_for(
                        self._inner.complete(request), timeout=self._call_timeout
                    )
            except TimeoutError as exc:
                raise LLMTimeoutError(f"LLM call exceeded {self._call_timeout}s") from exc
            except _RETRYABLE as exc:
                if attempt >= self._max_retries:
                    raise
                await self._sleep(self._delay(attempt, exc))
                attempt += 1

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        attempt = 0
        while True:
            started = False
            try:
                async with self._semaphore:
                    chunks = self._inner.stream(request).__aiter__()
                    while True:
                        try:
                            chunk = await asyncio.wait_for(
                                chunks.__anext__(), timeout=self._stream_idle_timeout
                            )
                        except StopAsyncIteration:
                            return
                        except TimeoutError as exc:
                            raise LLMTimeoutError(
                                f"LLM stream idle for {self._stream_idle_timeout}s"
                            ) from exc
                        started = True
                        yield chunk
            except _RETRYABLE as exc:
                if started or attempt >= self._max_retries:
                    raise
                await self._sleep(self._delay(attempt, exc))
                attempt += 1
