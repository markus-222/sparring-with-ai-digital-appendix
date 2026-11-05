"""Base agent: the plain LLM call the single-shot roles share."""

import logging

import pytest

from app.agents.base import BaseAgent
from app.agents.explorer import ExplorerAgent
from app.infra.fake_llm import FakeLLM
from app.infra.llm import LLMResponse, LLMUsage


class TestBaseAgent:
    """Test base agent LLM integration."""

    @pytest.mark.asyncio
    async def test_call_llm_sends_system_prompt_and_message_and_returns_the_content(self):
        fake = FakeLLM(["Hello from LLM"])
        agent = BaseAgent(fake)

        result = await agent._call_llm(agent._build_messages("Test message", None))

        assert result == {"content": "Hello from LLM", "finish_reason": None}
        sent = fake.requests[0]
        assert sent.messages == [
            {"role": "system", "content": agent.system_prompt},
            {"role": "user", "content": "Test message"},
        ]
        assert sent.max_tokens == agent.max_tokens
        assert sent.tools is None


class TestUsageReporting:
    """Token usage reported by the LLM port is logged with the agent name."""

    _USAGE = LLMUsage(
        input_tokens=120, output_tokens=15, cache_read_tokens=100, cache_write_tokens=8
    )

    @pytest.mark.asyncio
    async def test_call_llm_logs_usage_with_the_agent_name(self, caplog):
        agent = BaseAgent(FakeLLM([LLMResponse(content="Hi", usage=self._USAGE)]))

        with caplog.at_level(logging.INFO):
            result = await agent._call_llm(agent._build_messages("Test message", None))

        assert result["content"] == "Hi"
        assert "[base] usage input=120 output=15 cache_read=100 cache_write=8" in caplog.text

    @pytest.mark.asyncio
    async def test_call_llm_without_usage_logs_nothing(self, caplog):
        agent = BaseAgent(FakeLLM(["Hi"]))

        with caplog.at_level(logging.INFO):
            await agent._call_llm(agent._build_messages("Test message", None))

        assert "usage input=" not in caplog.text


class TestExplorerAgent:
    """Test explorer agent configuration."""

    def test_name_is_explorer(self):
        agent = ExplorerAgent(FakeLLM())
        assert agent.name == "explorer"
