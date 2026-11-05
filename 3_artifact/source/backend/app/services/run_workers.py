"""The worker registry the lifespan hands to the RunManager."""

from app.infra.llm import LLMClient
from app.schemas.run import RunType
from app.services.draft_run import make_draft_worker
from app.services.review_run import make_review_worker
from app.services.run_manager import RunWorker


def build_run_workers(llm: LLMClient) -> dict[RunType, RunWorker]:
    return {
        "draft": make_draft_worker(llm),
        "review": make_review_worker(llm),
    }
