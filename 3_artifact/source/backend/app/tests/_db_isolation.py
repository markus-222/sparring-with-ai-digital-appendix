"""Dedicated test-database provisioning (not a pytest test module — leading
underscore keeps it out of pytest's `test_*.py` collection).

Tests must never touch the dev database (`app.database.engine`'s target).
This module points a completely separate engine at a `_test`-suffixed
sibling database on the same Postgres server, self-provisioning it
(create-if-missing + migrate) so `make check` / `make test-unit` need no
docker-compose or Makefile changes.
"""

import os
import subprocess
from pathlib import Path

import asyncpg  # type: ignore[import-untyped]
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

_BACKEND_ROOT = Path(__file__).resolve().parents[2]

_base_url, _, _db_name = settings.DATABASE_URL.rpartition("/")
TEST_DATABASE_URL = f"{_base_url}/{_db_name}_test"
_TEST_DB_NAME = f"{_db_name}_test"
_ADMIN_URL = f"{_base_url}/postgres".replace("postgresql+asyncpg://", "postgresql://")

# NullPool: pytest-asyncio's default function-scoped event loop means a
# pooled connection opened in one test's loop is unusable in the next
# test's loop. NullPool opens/closes a fresh DBAPI connection per checkout,
# so the engine can safely be a module-level singleton shared across tests.
test_engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)


async def ensure_test_database_exists() -> None:
    """Create the `_test` database on the shared Postgres server if missing."""
    conn = await asyncpg.connect(_ADMIN_URL)
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", _TEST_DB_NAME)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{_TEST_DB_NAME}"')
    finally:
        await conn.close()


def run_migrations() -> None:
    """Run `alembic upgrade head` against the test database in a subprocess.

    A subprocess (not an in-process alembic.command call) is required: this
    module imports `app.config.settings`, which is already-instantiated
    elsewhere in the process against the real `DATABASE_URL`. `env.py` reads
    the env var fresh in a new process, so overriding it here can't leak
    into (or be affected by) the app's already-bound settings singleton.
    """
    subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=_BACKEND_ROOT,
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
        check=True,
    )
