"""get_run_manager reads the manager the lifespan stored on app.state (no DB)."""

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.requests import Request

from app.api.dependencies import get_run_manager
from app.services.run_manager import RunManager


def test_get_run_manager_returns_app_state_manager() -> None:
    app = FastAPI()
    manager = RunManager(async_sessionmaker(), {}, timeout=1.0)
    app.state.run_manager = manager
    request = Request({"type": "http", "app": app, "headers": []})

    assert get_run_manager(request) is manager
