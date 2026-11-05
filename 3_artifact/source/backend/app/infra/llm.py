"""LLM port: the narrow interface agents use to talk to a model provider."""

from collections.abc import AsyncIterator
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field


class LLMError(Exception):
    """Provider-independent LLM failure."""


class LLMRateLimitError(LLMError):
    """Provider answered 429. `retry_after` is the Retry-After header in seconds."""

    def __init__(self, message: str = "rate limited", *, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class LLMUnavailableError(LLMError):
    """Provider answered 503/overloaded or the connection failed."""


class LLMTimeoutError(LLMError):
    """A call exceeded its explicit timeout."""


class LLMRequest(BaseModel):
    messages: list[dict[str, Any]]
    max_tokens: int = 4096
    tools: list[dict[str, Any]] | None = None
    tool_choice: dict[str, Any] | str | None = None
    response_format: dict[str, str] | None = None
    reasoning_effort: str | None = None  # None = provider default
    model: str | None = None  # bare model name; None = the client's default model


class LLMUsage(BaseModel):
    input_tokens: int = 0  # all prompt tokens, cached ones included
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0


class LLMResponse(BaseModel):
    content: str | None = None
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    usage: LLMUsage | None = None
    finish_reason: str | None = None  # "length" = cut off at max_tokens


class LLMStreamChunk(BaseModel):
    kind: Literal["token", "tool_calls", "usage", "finish"]
    content: str = ""
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    usage: LLMUsage | None = None
    finish_reason: str | None = None  # kind "finish" only; "length" = cut off at max_tokens


class LLMClient(Protocol):
    async def complete(self, request: LLMRequest) -> LLMResponse: ...

    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]: ...
