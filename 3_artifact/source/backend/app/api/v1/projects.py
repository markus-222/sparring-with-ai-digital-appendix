"""Projects API – CRUD with owner-scoped access."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.database import get_db
from app.models.project import Project
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate
from app.services.slot_service import ensure_slots

router = APIRouter()


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Any]:
    """List projects owned by the current user."""
    stmt = (
        select(Project)
        .where(Project.owner_id == current_user.id)
        .order_by(Project.created_at.desc())
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("", response_model=ProjectResponse, status_code=201)
async def create_project(
    project: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Create a new project owned by the current user."""
    db_project = Project(
        name=project.name,
        description=project.description,
        owner_id=current_user.id,
    )
    db.add(db_project)
    await db.flush()
    await ensure_slots(db, db_project.id)
    await db.refresh(db_project)
    return db_project


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Get a project by ID (must be owner)."""
    project = await _get_owned_project(project_id, current_user.id, db)
    return project


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    update: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Update a project (must be owner)."""
    project = await _get_owned_project(project_id, current_user.id, db)
    if update.name is not None:
        project.name = update.name
    if update.description is not None:
        project.description = update.description
    await db.flush()
    await db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a project and all its sessions/documents (must be owner)."""
    project = await _get_owned_project(project_id, current_user.id, db)
    await db.delete(project)


async def _get_owned_project(project_id: str, owner_id: str, db: AsyncSession) -> Project:
    """Fetch project by ID and verify ownership. Returns 404 for missing or foreign projects."""
    stmt = select(Project).where(Project.id == project_id, Project.owner_id == owner_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
