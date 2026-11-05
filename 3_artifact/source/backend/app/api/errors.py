"""Helpers for typed HTTP errors."""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.session import Session
from app.schemas.errors import ApiError
from app.services.run_lock import ProjectLockedError, assert_project_unlocked


def conflict(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=ApiError(code=code, message=message).model_dump())


async def require_unlocked(db: AsyncSession, project_id: str) -> None:
    try:
        await assert_project_unlocked(db, project_id)
    except ProjectLockedError as exc:
        raise conflict("run_active", "A run is active. Please wait until it has finished.") from exc


async def verify_session_owner(db: AsyncSession, session_id: str, owner_id: str) -> Session:
    """404 for missing or foreign sessions (IDOR-safe, same as the sessions routes)."""
    result = await db.execute(
        select(Session)
        .join(Project, Session.project_id == Project.id)
        .where(Session.id == session_id, Project.owner_id == owner_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session
