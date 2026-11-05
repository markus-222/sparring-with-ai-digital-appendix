"""The worker registry covers every implemented run type."""

from app.infra.fake_llm import FakeLLM
from app.services.run_workers import build_run_workers


def test_all_run_types_are_registered() -> None:
    assert set(build_run_workers(FakeLLM())) == {"draft", "review"}
