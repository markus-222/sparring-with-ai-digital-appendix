"""Approval and approved versions. Only approved copies are stored."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.artifact_version import ArtifactVersion
from app.models.comment import Comment
from app.services.artifact_templates import TEMPLATES
from app.services.slot_service import SLOT_TYPES

ApprovalFailure = Literal["not_draft", "open_comments", "not_reviewed"]


class ApprovalError(Exception):
    def __init__(self, code: ApprovalFailure, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ApprovedArtifact:
    artifact_id: str
    type: str
    title: str
    version_no: int
    content: str
    current_status: str


async def approve_artifact(
    db: AsyncSession, artifact: Artifact, *, force: bool = False
) -> ArtifactVersion:
    # Row lock serializes a double click: the second request sees status "approved".
    await db.refresh(artifact, with_for_update=True)
    if artifact.status != "draft":
        raise ApprovalError("not_draft", "Only draft artifacts can be approved.")
    open_comments = (
        await db.execute(
            select(func.count())
            .select_from(Comment)
            .where(Comment.artifact_id == artifact.id, Comment.status == "open")
        )
    ).scalar_one()
    if open_comments:
        raise ApprovalError("open_comments", "Resolve all open comments first.")
    if not artifact.reviewed_since_change and not force:
        raise ApprovalError("not_reviewed", "This draft hasn't been reviewed yet.")
    last_no = (
        await db.execute(
            select(func.max(ArtifactVersion.version_no)).where(
                ArtifactVersion.artifact_id == artifact.id
            )
        )
    ).scalar_one()
    version = ArtifactVersion(
        artifact_id=artifact.id, version_no=(last_no or 0) + 1, content=artifact.content
    )
    db.add(version)
    artifact.status = "approved"
    await db.flush()
    return version


async def get_last_approved(db: AsyncSession, artifact_id: str) -> ArtifactVersion | None:
    result = await db.execute(
        select(ArtifactVersion)
        .where(ArtifactVersion.artifact_id == artifact_id)
        .order_by(ArtifactVersion.version_no.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def list_approved_foundation(db: AsyncSession, project_id: str) -> list[ApprovedArtifact]:
    """Last approved version of each slot artifact, ordered 01, 02, 03.

    An approved artifact that was edited back to draft still contributes its
    last approved text.
    """
    rows = (
        await db.execute(
            select(Artifact, ArtifactVersion)
            .join(ArtifactVersion, ArtifactVersion.artifact_id == Artifact.id)
            .where(Artifact.project_id == project_id, Artifact.type.in_(SLOT_TYPES))
            .distinct(ArtifactVersion.artifact_id)
            .order_by(ArtifactVersion.artifact_id, ArtifactVersion.version_no.desc())
        )
    ).all()
    order = {t.type: index for index, t in enumerate(TEMPLATES)}
    found = [
        ApprovedArtifact(a.id, a.type, a.title, v.version_no, v.content, a.status) for a, v in rows
    ]
    return sorted(found, key=lambda item: order[item.type])
