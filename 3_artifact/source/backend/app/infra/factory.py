"""Builds the production LLM client: LiteLLM adapter wrapped in ResilientLLM."""

from app.config import Settings
from app.infra.litellm_client import LiteLLMClient
from app.infra.llm import LLMClient
from app.infra.resilient import ResilientLLM


def build_llm_client(cfg: Settings) -> LLMClient:
    return ResilientLLM(
        LiteLLMClient(
            model=cfg.litellm_model,
            api_key=cfg.ANTHROPIC_AUTH_TOKEN,
            api_base=cfg.ANTHROPIC_BASE_URL,
            timeout=cfg.LLM_TIMEOUT_SECONDS,
        ),
        max_concurrency=cfg.LLM_MAX_CONCURRENCY,
        max_retries=cfg.LLM_MAX_RETRIES,
        base_delay=cfg.LLM_RETRY_BASE_DELAY,
        max_delay=cfg.LLM_RETRY_MAX_DELAY,
        call_timeout=cfg.LLM_TIMEOUT_SECONDS,
        stream_idle_timeout=cfg.LLM_STREAM_IDLE_TIMEOUT_SECONDS,
    )
