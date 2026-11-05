"""Test fixtures for the Master Thesis Prototype backend."""

import asyncio
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker

from app.api.dependencies import get_current_user, get_llm, get_run_manager
from app.database import get_db
from app.infra.fake_llm import FakeLLM
from app.main import app
from app.models.user import User
from app.schemas.run import RunType
from app.services.run_manager import RunManager, RunWorker, SessionFactory
from app.tests._db_isolation import ensure_test_database_exists, run_migrations, test_engine

# --- Fake authenticated user (overrides get_current_user in all route tests) ---

# Uses a `.invalid` address (reserved by RFC 2606 for exactly this purpose) so
# it can never collide with a real/faker-generated email created by other
# tests (e.g. test_auth.py registrations).
_FAKE_USER = User(
    id="test-user-id",
    username="conftest-fixture-user@example.invalid",
    hashed_password="hashed",
    display_name="Test User",
)


async def _fake_current_user() -> User:
    return _FAKE_USER


async def _ensure_fake_user_persisted(db: AsyncSession) -> None:
    """Insert the fake user into this test's session if it isn't already there.

    `get_current_user` is overridden to hand back an in-memory `_FAKE_USER`
    instance, but several tables (e.g. `projects.owner_id`) enforce a real
    foreign key to `users.id`. Without a matching row, any route that creates
    a project (or anything owned by the user) fails with a
    ForeignKeyViolationError.
    """
    existing = await db.get(User, _FAKE_USER.id)
    if existing is None:
        db.add(
            User(
                id=_FAKE_USER.id,
                username=_FAKE_USER.username,
                hashed_password=_FAKE_USER.hashed_password,
                display_name=_FAKE_USER.display_name,
            )
        )
        await db.flush()


# --- Test database provisioning (dedicated `_test` DB, never the dev DB) ---


@pytest.fixture(scope="session", autouse=True)
def _provision_test_database() -> None:
    """Create (if missing) and migrate the dedicated test database.

    Runs once per test session, synchronously, via `asyncio.run` — a fresh
    throwaway event loop independent of pytest-asyncio's per-test loop
    scoping, so it can't interfere with (or be affected by) the function-
    scoped loops individual async tests run in.
    """
    asyncio.run(ensure_test_database_exists())
    run_migrations()


@pytest.fixture
async def db_connection() -> AsyncGenerator[AsyncConnection, None]:
    """One connection with an outer transaction, rolled back at teardown.

    Every session built on it (db_session and the RunManager's own sessions)
    uses join_transaction_mode="create_savepoint": app code calling
    `session.commit()` only releases a SAVEPOINT, so nothing outlives the test.
    """
    async with test_engine.connect() as conn:
        await conn.begin()
        yield conn
        await conn.rollback()


@pytest.fixture
def session_factory(db_connection: AsyncConnection) -> SessionFactory:
    return async_sessionmaker(
        bind=db_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )


@pytest.fixture
async def db_session(session_factory: SessionFactory) -> AsyncGenerator[AsyncSession, None]:
    session = session_factory()
    try:
        yield session
    finally:
        await session.close()


@pytest.fixture
def run_workers() -> dict[RunType, RunWorker]:
    """Mutable worker registry; tests register the workers they need."""
    return {}


@pytest.fixture
async def run_manager(
    session_factory: SessionFactory, run_workers: dict[RunType, RunWorker]
) -> AsyncGenerator[RunManager, None]:
    manager = RunManager(session_factory, run_workers, timeout=5.0)
    yield manager
    await manager.shutdown()


# --- HTTP Test Client ---


@pytest.fixture
def fake_llm() -> FakeLLM:
    """Scripted LLM double. Tests queue replies via fake_llm.enqueue(...);
    an empty script answers "ok"."""
    return FakeLLM()


@pytest.fixture
async def client(
    db_session: AsyncSession, fake_llm: FakeLLM, run_manager: RunManager
) -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client for testing FastAPI endpoints.

    get_current_user is overridden so route tests don't need real JWT
    cookies, and get_db is overridden to hand out this test's isolated,
    rolled-back-at-teardown session. get_llm is overridden with the per-test
    fake_llm so no real LLM client is ever built or called.
    get_run_manager is overridden so runs use the test's savepoint connection.
    """

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_current_user] = _fake_current_user
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_llm] = lambda: fake_llm
    app.dependency_overrides[get_run_manager] = lambda: run_manager
    await _ensure_fake_user_persisted(db_session)
    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as ac:
        yield ac
    app.dependency_overrides.clear()
