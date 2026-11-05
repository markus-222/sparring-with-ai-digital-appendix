"""Runs API: start a background run, poll its progress."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, get_run_manager
from app.api.errors import conflict
from app.database import get_db
from app.models.project import Project
from app.models.run import Run
from app.models.user import User
from app.schemas.errors import ApiError
from app.schemas.run import RunCreate, RunResponse
from app.services.run_lock import get_active_run
from app.services.run_manager import RunManager, RunStartError
from app.services.run_preconditions import RunPreconditionError, check_run_preconditions

router = APIRouter()


@router.post("/projects/{project_id}/runs", response_model=RunResponse, status_code=202)
async def start_run(
    project_id: str,
    body: RunCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    manager: RunManager = Depends(get_run_manager),
) -> Any:
    """Start a run in the background and answer at once; poll GET /runs/{id}."""
    await _get_owned_project(project_id, current_user.id, db)
    try:
        await check_run_preconditions(db, project_id, body.type, body.slot)
    except RunPreconditionError as exc:
        raise conflict(exc.code, str(exc)) from exc
    try:
        return await manager.start(project_id, body.type, body.slot)
    except RunStartError as exc:
        if exc.code == "run_active":
            raise conflict(
                "run_active", "A run is active. Please wait until it has finished."
            ) from exc
        raise HTTPException(
            status_code=501,
            detail=ApiError(
                code="not_available", message="This run type is not available yet."
            ).model_dump(),
        ) from exc


@router.get("/projects/{project_id}/runs/active", response_model=RunResponse | None)
async def get_active_project_run(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """The running run of this project or null (resume progress after a reload)."""
    await _get_owned_project(project_id, current_user.id, db)
    return await get_active_run(db, project_id)


@router.get("/runs/{run_id}", response_model=RunResponse)
async def get_run(
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    # populate_existing: the run is updated by the RunManager's own sessions, so a
    # copy already in this session's identity map may be stale.
    stmt = (
        select(Run)
        .join(Project, Run.project_id == Project.id)
        .where(Run.id == run_id, Project.owner_id == current_user.id)
        .execution_options(populate_existing=True)
    )
    run = (await db.execute(stmt)).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


async def _get_owned_project(project_id: str, owner_id: str, db: AsyncSession) -> Project:
    stmt = select(Project).where(Project.id == project_id, Project.owner_id == owner_id)
    project = (await db.execute(stmt)).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
