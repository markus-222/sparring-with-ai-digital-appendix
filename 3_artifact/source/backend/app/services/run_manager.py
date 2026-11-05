"""Run manager: background workflow runs with a database lock.

A run is a row in `runs`. The partial unique index on (project_id) WHERE
state = 'running' is the lock. Workers get short-lived sessions only; no
session is held open across an LLM call. Logs carry only exception class
names, never messages or payloads.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.run import Run
from app.schemas.run import RunType, Slot

logger = logging.getLogger(__name__)

SessionFactory = async_sessionmaker[AsyncSession]

_LOCK_INDEX = "uq_runs_one_running_per_project"


class RunStartError(Exception):
    def __init__(self, code: Literal["run_active", "not_available"]) -> None:
        super().__init__(code)
        self.code = code


class RunContext:
    def __init__(
        self,
        run_id: str,
        project_id: str,
        run_type: RunType,
        slot: Slot,
        session_factory: SessionFactory,
        language: str | None = None,
    ) -> None:
        self.run_id = run_id
        self.project_id = project_id
        self.type = run_type
        self.slot = slot
        # The language the artifact is written in (the user's); None leaves it to the agent.
        self.language = language
        self._session_factory = session_factory

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self._session_factory() as db:
            try:
                yield db
                await db.commit()
            except BaseException:
                await db.rollback()
                raise

    async def set_step(self, step: str) -> None:
        async with self.session() as db:
            await db.execute(update(Run).where(Run.id == self.run_id).values(step=step))


RunWorker = Callable[[RunContext], Awaitable[None]]


class RunManager:
    def __init__(
        self,
        session_factory: SessionFactory,
        workers: Mapping[RunType, RunWorker],
        *,
        timeout: float,
    ) -> None:
        self._session_factory = session_factory
        self._workers = workers
        self._timeout = timeout
        self._tasks: dict[str, asyncio.Task[None]] = {}

    async def start(
        self, project_id: str, run_type: RunType, slot: Slot, *, language: str | None = None
    ) -> Run:
        worker = self._workers.get(run_type)
        if worker is None:
            raise RunStartError("not_available")
        run = Run(
            id=str(uuid.uuid4()), project_id=project_id, type=run_type, slot=slot, state="running"
        )
        async with self._session_factory() as db:
            db.add(run)
            try:
                await db.commit()
            except IntegrityError as exc:
                await db.rollback()
                if _LOCK_INDEX in str(exc.orig):
                    raise RunStartError("run_active") from exc
                raise
            await db.refresh(run)
        ctx = RunContext(run.id, project_id, run_type, slot, self._session_factory, language)
        task = asyncio.create_task(self._execute(ctx, worker))
        self._tasks[run.id] = task
        run_id = run.id

        def _forget(_done: asyncio.Task[None]) -> None:
            self._tasks.pop(run_id, None)

        task.add_done_callback(_forget)
        return run

    async def wait(self, run_id: str) -> None:
        task = self._tasks.get(run_id)
        if task is not None:
            await asyncio.wait({task})

    async def recover_interrupted(self) -> int:
        async with self._session_factory() as db:
            result = await db.execute(
                update(Run)
                .where(Run.state == "running")
                .values(state="failed", error="interrupted", finished_at=datetime.now(UTC))
                .returning(Run.id)
            )
            await db.commit()
        return len(result.all())

    async def shutdown(self) -> None:
        run_ids = list(self._tasks)
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # A task cancelled before its first step never runs `_execute`'s handlers,
        # so its row would stay 'running'. Close any such row here (idempotent).
        if run_ids:
            await self._interrupt(run_ids)

    async def _interrupt(self, run_ids: list[str]) -> None:
        try:
            async with self._session_factory() as db:
                await db.execute(
                    update(Run)
                    .where(Run.id.in_(run_ids), Run.state == "running")
                    .values(state="failed", error="interrupted", finished_at=datetime.now(UTC))
                )
                await db.commit()
        except Exception as exc:
            logger.error("Could not interrupt runs: %s", type(exc).__name__)

    async def _execute(self, ctx: RunContext, worker: RunWorker) -> None:
        try:
            async with asyncio.timeout(self._timeout):
                await worker(ctx)
        except TimeoutError:
            await self._finish(ctx.run_id, "failed", "timeout")
        except asyncio.CancelledError:
            await self._finish(ctx.run_id, "failed", "interrupted")
            raise
        except Exception as exc:
            logger.error("Run %s failed: %s", ctx.run_id, type(exc).__name__)
            await self._finish(ctx.run_id, "failed", type(exc).__name__[:100])
        else:
            await self._finish(ctx.run_id, "succeeded", None)

    async def _finish(self, run_id: str, state: str, error: str | None) -> None:
        try:
            async with self._session_factory() as db:
                await db.execute(
                    update(Run)
                    .where(Run.id == run_id)
                    .values(state=state, error=error, finished_at=datetime.now(UTC))
                )
                await db.commit()
        except Exception as exc:
            logger.error("Could not finish run %s: %s", run_id, type(exc).__name__)
