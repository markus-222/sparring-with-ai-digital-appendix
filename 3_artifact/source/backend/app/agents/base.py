"""Base agent: prompt loading and the plain LLM call of the single-shot roles."""

import logging
from pathlib import Path
from typing import Any

from app.infra.llm import LLMClient, LLMRequest

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"


def load_prompt(name: str) -> str:
    """Load an agent system prompt from agents/prompts/<name>.md."""
    return (_PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").strip()


class BaseAgent:
    """Base class of the agents that answer with one LLM call (draft, review roles).

    Subclasses define:
      - system_prompt: str
      - tools: list of tool definitions (OpenAI function-calling format)
    """

    name: str = "base"
    system_prompt: str = "You are a helpful assistant."
    max_tokens: int = 4096  # Token budget per LLM call
    response_format: dict[str, str] | None = None  # e.g. {"type": "json_object"}
    reasoning_effort: str | None = None  # caps hidden thinking, which counts against max_tokens

    def __init__(self, llm: LLMClient, model: str | None = None) -> None:
        self._llm = llm
        self._model = model  # None = the LLM client's default model
        self.tools: list[dict[str, Any]] = []

    def _build_messages(
        self, message: str, context: list[dict[str, str]] | None
    ) -> list[dict[str, Any]]:
        """Build the message list for the LLM call."""
        messages: list[dict[str, Any]] = [{"role": "system", "content": self.system_prompt}]
        if context:
            messages.extend(context)
        messages.append({"role": "user", "content": message})
        return messages

    def _request(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: dict[str, Any] | str | None = None,
        max_tokens: int | None = None,
        reasoning_effort: str | None = None,
    ) -> LLMRequest:
        effective_tools = tools if tools is not None else self.tools
        return LLMRequest(
            messages=messages,
            max_tokens=max_tokens or self.max_tokens,
            tools=effective_tools or None,
            tool_choice=tool_choice,
            response_format=self.response_format,
            reasoning_effort=reasoning_effort or self.reasoning_effort,
            model=self._model,
        )

    async def _call_llm(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: dict[str, Any] | str | None = None,
        max_tokens: int | None = None,
        reasoning_effort: str | None = None,
    ) -> dict[str, Any]:
        """Call the LLM port. `tools`/`tool_choice` override the agent's defaults for a
        forced call; `max_tokens`/`reasoning_effort` override them for one retry."""
        logger.debug(f"[{self.name}] LLM call with {len(messages)} messages")
        response = await self._llm.complete(
            self._request(messages, tools, tool_choice, max_tokens, reasoning_effort)
        )
        if response.usage is not None:
            usage = response.usage
            logger.info(
                f"[{self.name}] usage input={usage.input_tokens} output={usage.output_tokens} "
                f"cache_read={usage.cache_read_tokens} cache_write={usage.cache_write_tokens}"
            )
        result: dict[str, Any] = {
            "content": response.content,
            "finish_reason": response.finish_reason,
        }
        if response.tool_calls:
            result["tool_calls"] = response.tool_calls
        return result
