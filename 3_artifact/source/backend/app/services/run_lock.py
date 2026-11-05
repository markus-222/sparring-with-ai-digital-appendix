"""Project lock: an active run is a database fact (runs.state = 'running')."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.run import Run


class ProjectLockedError(Exception):
    def __init__(self, run_id: str) -> None:
        super().__init__("A run is active for this project.")
        self.run_id = run_id


async def get_active_run(db: AsyncSession, project_id: str) -> Run | None:
    result = await db.execute(
        select(Run).where(Run.project_id == project_id, Run.state == "running")
    )
    return result.scalar_one_or_none()


async def assert_project_unlocked(db: AsyncSession, project_id: str) -> None:
    active = await get_active_run(db, project_id)
    if active is not None:
        raise ProjectLockedError(active.id)
