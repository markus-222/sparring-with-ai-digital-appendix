"""Chat orchestration: one Analyst turn per message - context, tool loop, persistence."""

from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.analyst import AnalystAgent
from app.agents.chat_tools import TOOL_STATUS, build_tool_specs
from app.agents.tool_loop import TextDelta, ToolFinished, ToolStarted, TurnFinished
from app.infra.llm import LLMClient
from app.models.session import Session
from app.schemas.chat import (
    ChatEvent,
    ChatRequest,
    ChipClearedEvent,
    ErrorEvent,
    StatusEvent,
)
from app.schemas.tool_calls import ToolCallRecord, turn_record
from app.services.chat_context import ChatContext, build_chat_context
from app.services.chat_prompt import (
    approved_block,
    build_messages,
    documents_block,
    expand_history,
    turn_block,
)
from app.services.chat_replies import finish_reply, persist_message
from app.services.chat_texts import (
    ANALYST_LABEL,
    EMPTY_REPLY_FAILED,
    EMPTY_REPLY_OK,
    INTERRUPTED_NOTE,
    ROUND_LIMIT_NOTE,
    TRUNCATED_NOTE,
)
from app.services.chat_toolbox import ChatToolbox
from app.services.run_manager import RunManager
from app.services.session_title import derive_title

_LLM_FAILED = "LLM call failed"
_BLANK_LINE = "\n\n"


def _user_content(message: str, ctx: ChatContext) -> str:
    if ctx.chip is None:
        return message
    return f"📎 re: {ctx.chip.title}\n{message}"


def _stored_transcript(turn: TurnFinished, closing: str | None) -> list[dict[str, Any]]:
    """The turn's LLM messages for the replay; they never end on an empty assistant message."""
    transcript = list(turn.transcript)
    if transcript:
        last = transcript[-1]
        if last["role"] == "assistant" and not last["content"] and not last.get("tool_calls"):
            transcript.pop()
    if closing is not None:
        transcript.append({"role": "assistant", "content": closing})
    return transcript


class ChatService:
    def __init__(self, llm: LLMClient, run_manager: RunManager) -> None:
        self._llm = llm
        self._run_manager = run_manager

    async def stream(
        self, db: AsyncSession, session: Session, request: ChatRequest
    ) -> AsyncIterator[ChatEvent]:
        ctx = await build_chat_context(
            db,
            session.project_id,
            session.id,
            open_artifact_id=request.open_artifact_id,
            comment_id=request.comment_id,
            editor_open=request.editor_open,
        )
        if request.comment_id is not None and ctx.chip is None:
            yield "chip_cleared", ChipClearedEvent()
        await persist_message(db, session.id, "user", _user_content(request.message, ctx), None)
        if session.title is None:
            session.title = derive_title(request.message)
        toolbox = ChatToolbox(
            db,
            self._run_manager,
            session_id=session.id,
            project_id=session.project_id,
            open_artifact=ctx.open_artifact,
            chip=ctx.chip,
            editor_open=request.editor_open,
            confirmable=ctx.confirmable,
        )
        specs = build_tool_specs(toolbox, with_comment=ctx.chip is not None)
        messages = build_messages(
            system_prompt=AnalystAgent.system_prompt,
            documents=documents_block(ctx.documents),
            approved=approved_block(ctx.approved),
            history=expand_history(ctx.history),
            turn=turn_block(
                state=ctx.state_summary,
                open_artifact=ctx.open_artifact,
                chip=ctx.chip,
                events=ctx.events,
            ),
            user_message=request.message,
        )
        async for event in AnalystAgent(self._llm).stream(messages, specs):
            if isinstance(event, TextDelta):
                yield "token", event.text
            elif isinstance(event, ToolStarted):
                yield "status", StatusEvent(message=TOOL_STATUS.get(event.name, event.name))
            elif isinstance(event, ToolFinished):
                events = toolbox.take_events()
                if events:
                    # The client refetches the artifact on these events, over its own connection.
                    await db.commit()
                    for item in events:
                        yield item
            else:
                async for item in self._finish(db, session.id, toolbox, event):
                    yield item

    async def _finish(
        self, db: AsyncSession, session_id: str, toolbox: ChatToolbox, turn: TurnFinished
    ) -> AsyncIterator[ChatEvent]:
        """Close the turn: fixed notes and fallbacks, the label, persistence and `done`."""
        content = turn.content if turn.content.strip() else ""
        if turn.failed and not content and not turn.calls:
            yield "error", ErrorEvent(message=_LLM_FAILED)
            return
        closing: str | None = None
        if turn.failed or not turn.complete or turn.truncated:
            if turn.failed:
                closing = INTERRUPTED_NOTE
            else:
                closing = TRUNCATED_NOTE if turn.complete else ROUND_LIMIT_NOTE
            if content:
                yield "token", _BLANK_LINE
                content += _BLANK_LINE
        elif not content:
            ok = bool(turn.calls) and all(call.ok for call in turn.calls)
            closing = EMPTY_REPLY_OK if ok else EMPTY_REPLY_FAILED
        if closing is not None:
            yield "token", closing
            content += closing
        effects = toolbox.effects
        calls = [
            ToolCallRecord(name=call.name, arguments=call.arguments, ok=call.ok)
            for call in turn.calls
        ]
        done = await finish_reply(
            db,
            session_id,
            ANALYST_LABEL,
            "analyst",
            content,
            pending=effects.pending,
            tool_calls=turn_record(calls, _stored_transcript(turn, closing), effects.asked_slots),
            proposal=effects.proposal,
        )
        for item in toolbox.take_events():
            yield item
        yield done
