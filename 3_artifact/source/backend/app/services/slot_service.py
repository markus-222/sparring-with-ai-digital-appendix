"""Fixed artifact slots 01-03 per project."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.artifact_version import ArtifactVersion
from app.models.comment import Comment
from app.models.workshop_question import WorkshopQuestion
from app.schemas.run import Slot
from app.services.artifact_templates import TEMPLATES, get_template

SLOT_TYPES: frozenset[str] = frozenset(t.type for t in TEMPLATES)


async def ensure_slots(db: AsyncSession, project_id: str) -> list[Artifact]:
    """Create the missing slot artifacts (status not_started); return the new ones."""
    existing = set(
        (
            await db.execute(
                select(Artifact.type).where(
                    Artifact.project_id == project_id, Artifact.type.in_(SLOT_TYPES)
                )
            )
        )
        .scalars()
        .all()
    )
    created = [
        Artifact(
            id=str(uuid.uuid4()),
            project_id=project_id,
            type=template.type,
            title=template.title,
            content="",
            status="not_started",
        )
        for template in TEMPLATES
        if template.type not in existing
    ]
    db.add_all(created)
    await db.flush()
    return created


async def reset_slot_artifact(db: AsyncSession, artifact: Artifact) -> None:
    """Start over: back to not_started with no text, comments or approved versions.

    Approved versions go too, otherwise they would still feed later artifacts as foundation.
    Deleting 03 also drops the project's collected workshop questions, which would flow back
    into the next draft.
    """
    await db.execute(delete(Comment).where(Comment.artifact_id == artifact.id))
    await db.execute(delete(ArtifactVersion).where(ArtifactVersion.artifact_id == artifact.id))
    if artifact.type == get_template("03").type:
        await db.execute(
            delete(WorkshopQuestion).where(WorkshopQuestion.project_id == artifact.project_id)
        )
    artifact.content = ""
    artifact.status = "not_started"
    artifact.reviewed_since_change = False
    await db.flush()


async def get_slot_artifact(db: AsyncSession, project_id: str, slot: Slot) -> Artifact:
    template = get_template(slot)
    result = await db.execute(
        select(Artifact).where(Artifact.project_id == project_id, Artifact.type == template.type)
    )
    return result.scalar_one()
