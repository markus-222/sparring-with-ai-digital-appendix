import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import async_session, engine
from app.infra.factory import build_llm_client

# Import models to register all SQLAlchemy relationships
from app.models import Artifact as _Artifact  # noqa: F401
from app.models import Document as _Document  # noqa: F401
from app.models import Message as _Message  # noqa: F401
from app.models import Project as _Project  # noqa: F401
from app.models import Session as _Session  # noqa: F401
from app.services.run_manager import RunManager
from app.services.run_workers import build_run_workers

logging.basicConfig(level=logging.INFO)
# Enable DEBUG for agent modules during development
logging.getLogger("app.agents").setLevel(logging.DEBUG)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: startup and shutdown events."""
    # Startup: verify DB connection
    logger.info("Connecting to database...")
    async with engine.begin() as conn:
        from sqlalchemy import text

        await conn.execute(text("SELECT 1"))
    logger.info("Database connected.")
    app.state.llm = build_llm_client(settings)
    run_workers = build_run_workers(app.state.llm)
    run_manager = RunManager(async_session, run_workers, timeout=settings.RUN_TIMEOUT_SECONDS)
    app.state.run_workers = run_workers
    app.state.run_manager = run_manager
    recovered = await run_manager.recover_interrupted()
    if recovered:
        logger.warning("Marked %d interrupted run(s) as failed.", recovered)
    yield
    # Shutdown
    await run_manager.shutdown()
    await engine.dispose()
    logger.info("Database connection closed.")


app = FastAPI(
    title="Master Thesis Prototype API",
    description="Multi-agent AI system for Requirements Engineering",
    version="0.1.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes (lazy import to avoid circular deps at startup)
from app.api.v1.router import api_router  # noqa: E402

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check() -> dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "llm_provider": "anthropic",
        "model": settings.ANTHROPIC_MODEL,
    }
