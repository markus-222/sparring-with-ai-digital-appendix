"""Scripted LLM double for unit tests: deterministic, no network."""

from collections import deque
from collections.abc import AsyncIterator, Sequence

from app.infra.llm import LLMRequest, LLMResponse, LLMStreamChunk


class FakeLLM:
    def __init__(
        self,
        script: Sequence[LLMResponse | Exception | str] = (),
        *,
        default: str = "ok",
    ) -> None:
        self._script: deque[LLMResponse | Exception | str] = deque(script)
        self._default = default
        self.requests: list[LLMRequest] = []

    def enqueue(self, *items: LLMResponse | Exception | str) -> None:
        self._script.extend(items)

    def _next(self) -> LLMResponse:
        item = self._script.popleft() if self._script else self._default
        if isinstance(item, Exception):
            raise item
        if isinstance(item, str):
            return LLMResponse(content=item)
        return item

    async def complete(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        return self._next()

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        self.requests.append(request)
        response = self._next()
        if response.content:
            for index, word in enumerate(response.content.split(" ")):
                yield LLMStreamChunk(kind="token", content=word if index == 0 else f" {word}")
        if response.tool_calls:
            yield LLMStreamChunk(kind="tool_calls", tool_calls=response.tool_calls)
        if response.usage is not None:
            yield LLMStreamChunk(kind="usage", usage=response.usage)
        if response.finish_reason is not None:
            yield LLMStreamChunk(kind="finish", finish_reason=response.finish_reason)
