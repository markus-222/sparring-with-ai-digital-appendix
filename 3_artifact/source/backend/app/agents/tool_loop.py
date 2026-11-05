"""Streaming tool loop: the model streams text and calls tools, round after round."""

import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from app.infra.llm import LLMClient, LLMError, LLMRequest, LLMUsage

logger = logging.getLogger(__name__)

_ROUND_SEPARATOR = "\n\n"
_CUT_OFF = (
    "The reply reached the output limit, so the arguments of {name} were cut off and the call "
    "was not executed. Nothing was changed by it. Do the work in smaller calls, for example "
    "one section per call."
)


@dataclass(frozen=True)
class ToolOutcome:
    ok: bool
    content: str  # English text for the model


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON schema sent to the model
    args_model: type[BaseModel]  # validates the raw arguments
    handler: Callable[[Any], Awaitable[ToolOutcome]]  # receives the validated args model


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict[str, Any]
    ok: bool


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ToolStarted:
    name: str


@dataclass(frozen=True)
class ToolFinished:
    name: str
    ok: bool


@dataclass(frozen=True)
class TurnFinished:
    content: str  # every streamed text, rounds joined by "\n\n"
    transcript: list[dict[str, Any]]  # LLM messages produced in this turn, in order
    calls: list[ToolCall]
    usage: LLMUsage  # summed over all rounds
    complete: bool  # False: round limit reached
    failed: bool  # True: an LLMError ended the turn
    truncated: bool = False  # True: the final reply was cut off at the output limit


LoopEvent = TextDelta | ToolStarted | ToolFinished | TurnFinished


def _add_usage(total: LLMUsage, extra: LLMUsage) -> LLMUsage:
    return LLMUsage(
        input_tokens=total.input_tokens + extra.input_tokens,
        output_tokens=total.output_tokens + extra.output_tokens,
        cache_read_tokens=total.cache_read_tokens + extra.cache_read_tokens,
        cache_write_tokens=total.cache_write_tokens + extra.cache_write_tokens,
    )


def _round_text(tokens: list[str]) -> str:
    """The round's text; whitespace-only text counts as none (providers reject blank blocks)."""
    text = "".join(tokens)
    return text if text.strip() else ""


def _is_json(raw: str) -> bool:
    try:
        json.loads(raw.strip() or "{}")
    except json.JSONDecodeError:
        return False
    return True


def _parse_arguments(raw: str) -> dict[str, Any]:
    """The arguments as a dict; `{}` when the string is not a JSON object."""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _invalid_arguments(name: str, error: ValidationError) -> ToolOutcome:
    paths = dict.fromkeys(
        ".".join(str(part) for part in e["loc"]) for e in error.errors() if e["loc"]
    )
    detail = ", ".join(paths) or "malformed or incomplete JSON"
    return ToolOutcome(
        False,
        f"Invalid arguments for {name}: {detail}. "
        "Call the tool again with complete, valid arguments.",
    )


async def _execute(spec: ToolSpec | None, name: str, raw_arguments: str) -> ToolOutcome:
    if spec is None:
        return ToolOutcome(False, f"Unknown tool: {name}")
    try:
        # A tool without parameters may arrive with an empty argument string.
        args = spec.args_model.model_validate_json(raw_arguments.strip() or "{}")
    except ValidationError as error:
        return _invalid_arguments(name, error)
    return await spec.handler(args)


async def run_tool_loop(
    llm: LLMClient,
    messages: list[dict[str, Any]],
    tools: Sequence[ToolSpec],
    *,
    max_tokens: int,
    max_rounds: int = 8,
) -> AsyncIterator[LoopEvent]:
    """Run one turn: stream text live, execute requested tools, continue until the model stops.

    `messages` is never modified; the messages produced by the turn end up in
    `TurnFinished.transcript`. Handler exceptions propagate: they are bugs, expected
    failures are `ToolOutcome(ok=False, ...)`.
    """
    specs = {spec.name: spec for spec in tools}
    schemas = [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.parameters,
            },
        }
        for spec in tools
    ]
    transcript: list[dict[str, Any]] = []
    calls: list[ToolCall] = []
    texts: list[str] = []
    usage = LLMUsage()

    def finished(*, complete: bool, failed: bool, truncated: bool = False) -> TurnFinished:
        return TurnFinished(
            content=_ROUND_SEPARATOR.join(texts),
            transcript=transcript,
            calls=calls,
            usage=usage,
            complete=complete,
            failed=failed,
            truncated=truncated,
        )

    for _ in range(max_rounds):
        request = LLMRequest(
            messages=[*messages, *transcript], max_tokens=max_tokens, tools=schemas or None
        )
        round_tokens: list[str] = []
        raw_calls: list[dict[str, Any]] = []
        round_usage = LLMUsage()
        cut_off = False

        try:
            async for chunk in llm.stream(request):
                if chunk.kind == "token" and chunk.content:
                    if texts and not round_tokens:
                        yield TextDelta(_ROUND_SEPARATOR)
                    round_tokens.append(chunk.content)
                    yield TextDelta(chunk.content)
                elif chunk.kind == "tool_calls":
                    raw_calls.extend(chunk.tool_calls)
                elif chunk.kind == "usage" and chunk.usage is not None:
                    round_usage = _add_usage(round_usage, chunk.usage)
                elif chunk.kind == "finish":
                    cut_off = chunk.finish_reason == "length"
        except LLMError as error:
            logger.error(f"[tool_loop] LLM error: {type(error).__name__}")
            text = _round_text(round_tokens)
            if text:
                texts.append(text)
                transcript.append({"role": "assistant", "content": text})
            yield finished(complete=False, failed=True)
            return

        usage = _add_usage(usage, round_usage)
        logger.info(
            f"[tool_loop] usage input={round_usage.input_tokens} "
            f"output={round_usage.output_tokens} cache_read={round_usage.cache_read_tokens} "
            f"cache_write={round_usage.cache_write_tokens}"
        )

        text = _round_text(round_tokens)
        if text:
            texts.append(text)
        if not raw_calls:
            transcript.append({"role": "assistant", "content": text})
            yield finished(complete=True, failed=False, truncated=cut_off)
            return

        # A call cut off at the output limit has incomplete JSON arguments: it is not executed,
        # and the transcript stores empty arguments so the provider accepts the replay.
        cut_ids = {
            raw_call["id"]
            for raw_call in raw_calls
            if cut_off and not _is_json(raw_call["function"]["arguments"])
        }
        if cut_ids:
            logger.warning(f"[tool_loop] {len(cut_ids)} tool call(s) cut off at max_tokens")
        stored_calls = [
            {**raw_call, "function": {**raw_call["function"], "arguments": "{}"}}
            if raw_call["id"] in cut_ids
            else raw_call
            for raw_call in raw_calls
        ]
        transcript.append({"role": "assistant", "content": text, "tool_calls": stored_calls})
        for raw_call in raw_calls:
            name = raw_call["function"]["name"]
            raw_arguments = raw_call["function"]["arguments"]
            yield ToolStarted(name)
            if raw_call["id"] in cut_ids:
                outcome = ToolOutcome(False, _CUT_OFF.format(name=name))
            else:
                outcome = await _execute(specs.get(name), name, raw_arguments)
            yield ToolFinished(name, outcome.ok)
            calls.append(ToolCall(name, _parse_arguments(raw_arguments), outcome.ok))
            transcript.append(
                {
                    "role": "tool",
                    "tool_call_id": raw_call["id"],
                    "name": name,
                    "content": outcome.content,
                }
            )

    yield finished(complete=False, failed=False)
