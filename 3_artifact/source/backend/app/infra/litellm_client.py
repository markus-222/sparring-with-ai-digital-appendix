"""LiteLLM adapter: the only module that imports litellm."""

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import litellm
import litellm.exceptions as litellm_exc

from app.infra.llm import (
    LLMError,
    LLMRateLimitError,
    LLMRequest,
    LLMResponse,
    LLMStreamChunk,
    LLMTimeoutError,
    LLMUnavailableError,
    LLMUsage,
)


def _retry_after(exc: Exception) -> float | None:
    headers = getattr(getattr(exc, "response", None), "headers", None)
    if headers is None:
        return None
    raw = headers.get("retry-after") or headers.get("Retry-After")
    try:
        return float(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def translate_error(exc: Exception) -> LLMError:
    if isinstance(exc, LLMError):
        return exc
    if isinstance(exc, litellm_exc.RateLimitError):
        return LLMRateLimitError(str(exc), retry_after=_retry_after(exc))
    if isinstance(
        exc,
        litellm_exc.ServiceUnavailableError
        | litellm_exc.InternalServerError
        | litellm_exc.APIConnectionError,
    ):
        return LLMUnavailableError(str(exc))
    if isinstance(exc, litellm_exc.Timeout):
        return LLMTimeoutError(str(exc))
    return LLMError(str(exc))


def _tool_call_dict(call: Any) -> dict[str, Any]:
    return {
        "id": call.id,
        "type": "function",
        "function": {"name": call.function.name, "arguments": call.function.arguments},
    }


def _usage(raw: Any) -> LLMUsage | None:
    if raw is None:
        return None

    def count(field: str) -> int:
        return int(getattr(raw, field, None) or 0)

    return LLMUsage(
        input_tokens=count("prompt_tokens"),
        output_tokens=count("completion_tokens"),
        cache_read_tokens=count("cache_read_input_tokens"),
        cache_write_tokens=count("cache_creation_input_tokens"),
    )


class LiteLLMClient:
    def __init__(
        self,
        *,
        model: str,
        api_key: str,
        api_base: str,
        timeout: float,
        completion: Callable[..., Awaitable[Any]] | None = None,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._api_base = api_base
        self._timeout = timeout
        self._completion = completion or litellm.acompletion

    def _kwargs(self, request: LLMRequest, *, stream: bool) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": f"anthropic/{request.model}" if request.model else self._model,
            "messages": request.messages,
            "max_tokens": request.max_tokens,
            "timeout": self._timeout,
            "api_key": self._api_key,
            "api_base": self._api_base,
        }
        if request.tools:
            kwargs["tools"] = request.tools
            kwargs["tool_choice"] = request.tool_choice or "auto"
        if request.response_format:
            kwargs["response_format"] = request.response_format
        if request.reasoning_effort:
            kwargs["reasoning_effort"] = request.reasoning_effort
        if stream:
            kwargs["stream"] = True
            kwargs["stream_options"] = {"include_usage": True}
        return kwargs

    async def complete(self, request: LLMRequest) -> LLMResponse:
        try:
            raw = await self._completion(**self._kwargs(request, stream=False))
        except Exception as exc:
            raise translate_error(exc) from exc
        message = raw.choices[0].message
        calls = getattr(message, "tool_calls", None) or []
        return LLMResponse(
            content=message.content,
            tool_calls=[_tool_call_dict(c) for c in calls],
            usage=_usage(getattr(raw, "usage", None)),
            finish_reason=getattr(raw.choices[0], "finish_reason", None),
        )

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        accumulated: dict[int, dict[str, Any]] = {}
        last_usage: Any = None
        finish_reason: str | None = None
        try:
            raw = await self._completion(**self._kwargs(request, stream=True))
            async for chunk in raw:
                if getattr(chunk, "usage", None) is not None:
                    last_usage = chunk.usage
                if chunk.choices:
                    finish_reason = (
                        getattr(chunk.choices[0], "finish_reason", None) or finish_reason
                    )
                delta = chunk.choices[0].delta if chunk.choices else None
                if not delta:
                    continue
                if delta.content:
                    yield LLMStreamChunk(kind="token", content=delta.content)
                for piece in getattr(delta, "tool_calls", None) or []:
                    slot = accumulated.setdefault(
                        piece.index,
                        {
                            "id": piece.id or "",
                            "type": "function",
                            "function": {"name": "", "arguments": ""},
                        },
                    )
                    if piece.id:
                        slot["id"] = piece.id
                    if piece.function:
                        if piece.function.name:
                            slot["function"]["name"] = piece.function.name
                        if piece.function.arguments:
                            slot["function"]["arguments"] += piece.function.arguments
        except Exception as exc:
            raise translate_error(exc) from exc
        if accumulated:
            yield LLMStreamChunk(kind="tool_calls", tool_calls=list(accumulated.values()))
        usage = _usage(last_usage)
        if usage is not None:
            yield LLMStreamChunk(kind="usage", usage=usage)
        if finish_reason is not None:
            yield LLMStreamChunk(kind="finish", finish_reason=finish_reason)
