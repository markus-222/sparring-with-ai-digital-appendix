"""Analyst chat agent: converses and acts through the tools it is given."""

from collections.abc import AsyncIterator, Sequence
from typing import Any

from app.agents.base import load_prompt
from app.agents.tool_loop import LoopEvent, ToolSpec, run_tool_loop
from app.infra.llm import LLMClient


class AnalystAgent:
    name = "analyst"
    # edit_artifact and rewrite_artifact arguments carry artifact text and share the turn's
    # token budget with prose; a whole artifact must fit.
    max_tokens = 16384
    max_rounds = 8
    system_prompt = load_prompt("analyst_chat")

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    def stream(
        self, messages: list[dict[str, Any]], tools: Sequence[ToolSpec]
    ) -> AsyncIterator[LoopEvent]:
        return run_tool_loop(
            self._llm, messages, tools, max_tokens=self.max_tokens, max_rounds=self.max_rounds
        )
