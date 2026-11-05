"""Sessions API – CRUD + message history."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.database import get_db
from app.models.message import Message
from app.models.project import Project
from app.models.session import Session
from app.models.user import User
from app.schemas.session import (
    MessageResponse,
    SessionCreate,
    SessionDetailResponse,
    SessionResponse,
)
from app.services.session_greeting import create_greeting

router = APIRouter()


@router.get("", response_model=list[SessionResponse])
async def list_sessions(
    project_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Any]:
    """List sessions owned by the current user, optionally filtered by project."""
    stmt = (
        select(Session)
        .join(Project, Session.project_id == Project.id)
        .where(Project.owner_id == current_user.id)
    )
    if project_id:
        stmt = stmt.where(Session.project_id == project_id)
    stmt = stmt.order_by(Session.updated_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(
    session: SessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Create a new chat session under a project owned by the current user."""
    await _get_owned_project(session.project_id, current_user.id, db)
    db_session = Session(
        id=str(uuid.uuid4()),
        project_id=session.project_id,
        title=session.title,
    )
    db.add(db_session)
    await db.flush()
    await create_greeting(db, session.project_id, db_session.id)
    await db.refresh(db_session)
    return db_session


@router.get("/{session_id}", response_model=SessionDetailResponse)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionDetailResponse:
    """Get a session with its chat messages (system events are hidden)."""
    stmt = (
        select(Session)
        .join(Project, Session.project_id == Project.id)
        .where(Session.id == session_id, Project.owner_id == current_user.id)
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = await db.execute(
        select(Message)
        .where(Message.session_id == session_id, Message.role != "system")
        .order_by(Message.created_at, Message.id)
    )
    return SessionDetailResponse(
        **SessionResponse.model_validate(session).model_dump(),
        messages=[MessageResponse.model_validate(m) for m in messages.scalars().all()],
    )


async def _get_owned_project(project_id: str, owner_id: str, db: AsyncSession) -> Project:
    """Fetch project by ID and verify ownership. Returns 404 for missing or foreign projects."""
    stmt = select(Project).where(Project.id == project_id, Project.owner_id == owner_id)
    result = await db.execute(stmt)
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
