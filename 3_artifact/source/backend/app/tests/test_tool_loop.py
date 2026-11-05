"""Streaming tool loop: text and tool calls in rounds, typed events, failure handling."""

import copy
import logging
from collections.abc import AsyncIterator
from typing import Any

import pytest
from pydantic import BaseModel

from app.agents.tool_loop import (
    LoopEvent,
    TextDelta,
    ToolCall,
    ToolFinished,
    ToolOutcome,
    ToolSpec,
    ToolStarted,
    TurnFinished,
    run_tool_loop,
)
from app.infra.fake_llm import FakeLLM
from app.infra.llm import (
    LLMRequest,
    LLMResponse,
    LLMStreamChunk,
    LLMUnavailableError,
    LLMUsage,
)

_USER = [{"role": "user", "content": "hi"}]


class EchoArgs(BaseModel):
    text: str
    count: int = 1


class NoArgs(BaseModel):
    pass


class _Question(BaseModel):
    text: str


class BatchArgs(BaseModel):
    questions: list[_Question]


def _call(call_id: str, name: str, arguments: str) -> dict[str, Any]:
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}


def _echo_call(call_id: str = "c1", text: str = "hi") -> dict[str, Any]:
    return _call(call_id, "echo", f'{{"text": "{text}"}}')


def _echo_tool(
    result: ToolOutcome | None = None,
) -> tuple[ToolSpec, list[EchoArgs]]:
    """The `echo` tool and the list of argument models its handler received."""
    received: list[EchoArgs] = []

    async def handler(args: EchoArgs) -> ToolOutcome:
        received.append(args)
        return result or ToolOutcome(True, f"echoed {args.text}")

    spec = ToolSpec(
        name="echo",
        description="Echo the text.",
        parameters=EchoArgs.model_json_schema(),
        args_model=EchoArgs,
        handler=handler,
    )
    return spec, received


async def _collect(
    llm: Any,
    tools: list[ToolSpec],
    *,
    messages: list[dict[str, Any]] | None = None,
    max_tokens: int = 256,
    max_rounds: int = 8,
) -> list[LoopEvent]:
    return [
        event
        async for event in run_tool_loop(
            llm,
            _USER if messages is None else messages,
            tools,
            max_tokens=max_tokens,
            max_rounds=max_rounds,
        )
    ]


def _finished(events: list[LoopEvent]) -> TurnFinished:
    last = events[-1]
    assert isinstance(last, TurnFinished)
    return last


@pytest.mark.asyncio
async def test_text_only_reply_streams_deltas_and_finishes() -> None:
    reply = "Hello brave new world"
    events = await _collect(FakeLLM([reply]), [])

    deltas = events[:-1]
    assert deltas and all(isinstance(e, TextDelta) for e in deltas)
    assert "".join(e.text for e in deltas if isinstance(e, TextDelta)) == reply
    assert events[-1] == TurnFinished(
        content=reply,
        transcript=[{"role": "assistant", "content": reply}],
        calls=[],
        usage=LLMUsage(),
        complete=True,
        failed=False,
    )


@pytest.mark.asyncio
async def test_tool_round_then_final_text() -> None:
    call = _echo_call()
    llm = FakeLLM([LLMResponse(content="first", tool_calls=[call]), "second"])
    echo, received = _echo_tool()

    events = await _collect(llm, [echo])

    assert events[:-1] == [
        TextDelta("first"),
        ToolStarted("echo"),
        ToolFinished("echo", True),
        TextDelta("\n\n"),
        TextDelta("second"),
    ]
    finished = _finished(events)
    tool_round = [
        {"role": "assistant", "content": "first", "tool_calls": [call]},
        {"role": "tool", "tool_call_id": "c1", "name": "echo", "content": "echoed hi"},
    ]
    assert finished.transcript == [*tool_round, {"role": "assistant", "content": "second"}]
    assert finished.content == "first\n\nsecond"
    assert finished.calls == [ToolCall("echo", {"text": "hi"}, True)]
    assert finished.complete and not finished.failed
    assert received == [EchoArgs(text="hi")]
    assert llm.requests[1].messages == [*_USER, *tool_round]


@pytest.mark.asyncio
async def test_no_separator_when_the_tool_round_had_no_text() -> None:
    llm = FakeLLM([LLMResponse(content="", tool_calls=[_echo_call()]), "answer"])
    echo, _ = _echo_tool()

    events = await _collect(llm, [echo])

    assert events[:-1] == [
        ToolStarted("echo"),
        ToolFinished("echo", True),
        TextDelta("answer"),
    ]
    assert _finished(events).content == "answer"


@pytest.mark.asyncio
async def test_whitespace_only_round_text_is_stored_empty_and_adds_no_separator() -> None:
    """Providers reject blank text blocks when the transcript is replayed."""
    call = _echo_call()
    llm = FakeLLM([LLMResponse(content="\n", tool_calls=[call]), "answer"])
    echo, _ = _echo_tool()

    events = await _collect(llm, [echo])

    assert events[:-1] == [
        TextDelta("\n"),
        ToolStarted("echo"),
        ToolFinished("echo", True),
        TextDelta("answer"),
    ]
    finished = _finished(events)
    assert finished.content == "answer"
    assert finished.transcript[0] == {"role": "assistant", "content": "", "tool_calls": [call]}


@pytest.mark.asyncio
async def test_two_tool_calls_in_one_round_run_in_order() -> None:
    calls = [_echo_call("c1", "one"), _echo_call("c2", "two")]
    llm = FakeLLM([LLMResponse(content="", tool_calls=calls), "done"])
    echo, received = _echo_tool()

    events = await _collect(llm, [echo])

    assert events[:4] == [
        ToolStarted("echo"),
        ToolFinished("echo", True),
        ToolStarted("echo"),
        ToolFinished("echo", True),
    ]
    assert [r.text for r in received] == ["one", "two"]
    finished = _finished(events)
    assert finished.calls == [
        ToolCall("echo", {"text": "one"}, True),
        ToolCall("echo", {"text": "two"}, True),
    ]
    tool_messages = [m for m in finished.transcript if m["role"] == "tool"]
    assert [(m["tool_call_id"], m["content"]) for m in tool_messages] == [
        ("c1", "echoed one"),
        ("c2", "echoed two"),
    ]


@pytest.mark.asyncio
async def test_malformed_json_arguments_are_not_executed() -> None:
    truncated = _call("c1", "echo", '{"text": "hi"')
    llm = FakeLLM([LLMResponse(tool_calls=[truncated]), "retrying"])
    echo, received = _echo_tool()

    events = await _collect(llm, [echo])

    assert received == []
    assert ToolFinished("echo", False) in events
    finished = _finished(events)
    assert finished.calls == [ToolCall("echo", {}, False)]
    message = finished.transcript[1]
    assert message["role"] == "tool"
    assert message["content"].startswith("Invalid arguments for echo:")
    assert "Call the tool again with complete, valid arguments." in message["content"]


@pytest.mark.asyncio
async def test_arguments_failing_the_model_name_the_fields() -> None:
    llm = FakeLLM([LLMResponse(tool_calls=[_call("c1", "echo", '{"count": "many"}')]), "ok"])
    echo, received = _echo_tool()

    finished = _finished(await _collect(llm, [echo]))

    assert received == []
    assert finished.transcript[1]["content"] == (
        "Invalid arguments for echo: text, count. "
        "Call the tool again with complete, valid arguments."
    )
    assert finished.calls == [ToolCall("echo", {"count": "many"}, False)]


@pytest.mark.asyncio
async def test_nested_field_errors_report_the_full_path() -> None:
    seen: list[BatchArgs] = []

    async def handler(args: BatchArgs) -> ToolOutcome:
        seen.append(args)
        return ToolOutcome(True, "added")

    batch = ToolSpec(
        name="batch",
        description="Add questions.",
        parameters=BatchArgs.model_json_schema(),
        args_model=BatchArgs,
        handler=handler,
    )
    call = _call("c1", "batch", '{"questions": [{"text": "a"}, {}]}')
    llm = FakeLLM([LLMResponse(tool_calls=[call]), "ok"])

    finished = _finished(await _collect(llm, [batch]))

    assert seen == []
    assert "Invalid arguments for batch: questions.1.text." in finished.transcript[1]["content"]


@pytest.mark.asyncio
async def test_empty_argument_string_counts_as_no_arguments() -> None:
    calls: list[NoArgs] = []

    async def handler(args: NoArgs) -> ToolOutcome:
        calls.append(args)
        return ToolOutcome(True, "resolved")

    resolve = ToolSpec(
        name="resolve",
        description="Resolve.",
        parameters={"type": "object", "properties": {}},
        args_model=NoArgs,
        handler=handler,
    )
    llm = FakeLLM([LLMResponse(tool_calls=[_call("c1", "resolve", "")]), "done"])

    finished = _finished(await _collect(llm, [resolve]))

    assert calls == [NoArgs()]
    assert finished.calls == [ToolCall("resolve", {}, True)]


@pytest.mark.asyncio
async def test_unknown_tool_reports_failure_to_the_model() -> None:
    llm = FakeLLM([LLMResponse(tool_calls=[_call("c1", "ghost", '{"a": 1}')]), "ok"])
    echo, received = _echo_tool()

    events = await _collect(llm, [echo])

    assert ToolStarted("ghost") in events
    assert ToolFinished("ghost", False) in events
    finished = _finished(events)
    assert finished.transcript[1]["content"] == "Unknown tool: ghost"
    assert finished.calls == [ToolCall("ghost", {"a": 1}, False)]
    assert received == []


@pytest.mark.asyncio
async def test_handler_refusal_is_returned_to_the_model() -> None:
    llm = FakeLLM([LLMResponse(tool_calls=[_echo_call()]), "understood"])
    echo, _ = _echo_tool(ToolOutcome(False, "nope"))

    events = await _collect(llm, [echo])

    assert ToolFinished("echo", False) in events
    finished = _finished(events)
    assert finished.transcript[1]["content"] == "nope"
    assert finished.calls == [ToolCall("echo", {"text": "hi"}, False)]
    assert finished.complete and not finished.failed


@pytest.mark.asyncio
async def test_handler_exception_propagates() -> None:
    async def handler(args: EchoArgs) -> ToolOutcome:
        raise RuntimeError("bug in the tool")

    broken = ToolSpec(
        name="echo",
        description="Echo.",
        parameters=EchoArgs.model_json_schema(),
        args_model=EchoArgs,
        handler=handler,
    )
    llm = FakeLLM([LLMResponse(tool_calls=[_echo_call()]), "unused"])

    with pytest.raises(RuntimeError, match="bug in the tool"):
        await _collect(llm, [broken])


@pytest.mark.asyncio
async def test_llm_error_in_the_first_round_ends_the_turn_empty(
    caplog: pytest.LogCaptureFixture,
) -> None:
    llm = FakeLLM([LLMUnavailableError("secret provider detail")])

    with caplog.at_level(logging.INFO):
        events = await _collect(llm, [])

    assert events == [
        TurnFinished(
            content="",
            transcript=[],
            calls=[],
            usage=LLMUsage(),
            complete=False,
            failed=True,
        )
    ]
    assert "LLMUnavailableError" in caplog.text
    assert "secret provider detail" not in caplog.text


@pytest.mark.asyncio
async def test_llm_error_in_a_later_round_keeps_what_exists() -> None:
    call = _echo_call()
    llm = FakeLLM([LLMResponse(content="first", tool_calls=[call]), LLMUnavailableError("down")])
    echo, _ = _echo_tool()

    finished = _finished(await _collect(llm, [echo]))

    assert finished.failed and not finished.complete
    assert finished.content == "first"
    assert finished.transcript == [
        {"role": "assistant", "content": "first", "tool_calls": [call]},
        {"role": "tool", "tool_call_id": "c1", "name": "echo", "content": "echoed hi"},
    ]
    assert finished.calls == [ToolCall("echo", {"text": "hi"}, True)]


class _CutOffLLM:
    """Streams one token, then the connection drops."""

    def __init__(self, token: str = "Hal") -> None:
        self._token = token

    async def complete(self, request: LLMRequest) -> LLMResponse:
        raise NotImplementedError

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        yield LLMStreamChunk(kind="token", content=self._token)
        raise LLMUnavailableError("cut off")


@pytest.mark.asyncio
async def test_llm_error_mid_round_keeps_the_text_already_streamed() -> None:
    events = await _collect(_CutOffLLM(), [])

    assert events[0] == TextDelta("Hal")
    finished = _finished(events)
    assert finished.failed and not finished.complete
    assert finished.content == "Hal"
    assert finished.transcript == [{"role": "assistant", "content": "Hal"}]


@pytest.mark.asyncio
async def test_llm_error_mid_round_drops_whitespace_only_text() -> None:
    finished = _finished(await _collect(_CutOffLLM("\n"), []))

    assert finished.failed
    assert finished.content == ""
    assert finished.transcript == []


@pytest.mark.asyncio
async def test_round_limit_ends_the_turn_incomplete() -> None:
    llm = FakeLLM([LLMResponse(content="again", tool_calls=[_echo_call()])] * 5)
    echo, received = _echo_tool()

    finished = _finished(await _collect(llm, [echo], max_rounds=2))

    assert len(llm.requests) == 2
    assert not finished.complete and not finished.failed
    assert len(received) == 2
    assert len(finished.calls) == 2
    assert finished.content == "again\n\nagain"
    assert [m["role"] for m in finished.transcript] == ["assistant", "tool"] * 2


@pytest.mark.asyncio
async def test_usage_is_summed_over_rounds_and_logged_per_round(
    caplog: pytest.LogCaptureFixture,
) -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                content="a",
                tool_calls=[_echo_call()],
                usage=LLMUsage(
                    input_tokens=100, output_tokens=10, cache_read_tokens=80, cache_write_tokens=5
                ),
            ),
            LLMResponse(
                content="b",
                usage=LLMUsage(input_tokens=120, output_tokens=7, cache_read_tokens=100),
            ),
        ]
    )
    echo, _ = _echo_tool()

    with caplog.at_level(logging.INFO):
        finished = _finished(await _collect(llm, [echo]))

    assert finished.usage == LLMUsage(
        input_tokens=220, output_tokens=17, cache_read_tokens=180, cache_write_tokens=5
    )
    assert [r.getMessage() for r in caplog.records if "usage" in r.getMessage()] == [
        "[tool_loop] usage input=100 output=10 cache_read=80 cache_write=5",
        "[tool_loop] usage input=120 output=7 cache_read=100 cache_write=0",
    ]


@pytest.mark.asyncio
async def test_request_carries_tool_schemas_and_leaves_messages_untouched() -> None:
    llm = FakeLLM([LLMResponse(tool_calls=[_echo_call()]), "done"])
    echo, _ = _echo_tool()
    messages = [{"role": "system", "content": "be brief"}, {"role": "user", "content": "hi"}]
    before = copy.deepcopy(messages)

    await _collect(llm, [echo], messages=messages, max_tokens=321)

    first = llm.requests[0]
    assert first.max_tokens == 321
    assert first.tools == [
        {
            "type": "function",
            "function": {
                "name": "echo",
                "description": "Echo the text.",
                "parameters": EchoArgs.model_json_schema(),
            },
        }
    ]
    assert first.messages == before
    assert messages == before


@pytest.mark.asyncio
async def test_request_without_tools_sends_none() -> None:
    llm = FakeLLM(["plain"])

    await _collect(llm, [])

    assert llm.requests[0].tools is None


async def test_a_call_cut_off_at_the_output_limit_is_not_executed_and_stored_empty() -> None:
    whole = _echo_call("c1", "first")
    cut = _call("c2", "echo", '{"text": "seco')
    llm = FakeLLM([LLMResponse(tool_calls=[whole, cut], finish_reason="length"), "smaller now"])
    echo, received = _echo_tool()

    events = await _collect(llm, [echo])

    assert [args.text for args in received] == ["first"]
    finished = _finished(events)
    assert finished.calls == [
        ToolCall("echo", {"text": "first"}, True),
        ToolCall("echo", {}, False),
    ]
    assert finished.transcript[0]["tool_calls"] == [
        _echo_call("c1", "first"),
        _call("c2", "echo", "{}"),
    ]
    cut_result = finished.transcript[2]
    assert cut_result["tool_call_id"] == "c2"
    assert cut_result["content"].startswith("The reply reached the output limit")
    assert (finished.complete, finished.truncated) == (True, False)
    assert finished.content == "smaller now"


async def test_a_final_reply_cut_off_at_the_output_limit_is_marked_truncated() -> None:
    llm = FakeLLM([LLMResponse(content="Half a sen", finish_reason="length")])

    finished = _finished(await _collect(llm, []))

    assert (finished.complete, finished.failed, finished.truncated) == (True, False, True)
    assert finished.content == "Half a sen"


async def test_a_normal_finish_reason_is_not_truncated() -> None:
    llm = FakeLLM([LLMResponse(content="Done.", finish_reason="stop")])

    assert _finished(await _collect(llm, [])).truncated is False
