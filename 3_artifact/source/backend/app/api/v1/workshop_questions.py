"""Project-wide list of accepted workshop questions."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.database import get_db
from app.models.project import Project
from app.models.user import User
from app.models.workshop_question import WorkshopQuestion
from app.schemas.workshop_question import WorkshopQuestionResponse

router = APIRouter()


@router.get(
    "/projects/{project_id}/workshop-questions", response_model=list[WorkshopQuestionResponse]
)
async def list_workshop_questions(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Any]:
    owned = await db.execute(
        select(Project.id).where(Project.id == project_id, Project.owner_id == current_user.id)
    )
    if owned.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Project not found")
    result = await db.execute(
        select(WorkshopQuestion)
        .where(WorkshopQuestion.project_id == project_id)
        .order_by(WorkshopQuestion.created_at, WorkshopQuestion.id)
    )
    return list(result.scalars().all())
