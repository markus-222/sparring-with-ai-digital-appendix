"""Artifacts API – CRUD + HITL lifecycle (draft/approved)."""

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.errors import conflict, require_unlocked
from app.database import get_db
from app.models.artifact import Artifact
from app.models.project import Project
from app.models.user import User
from app.schemas.artifact import (
    ApprovedVersionResponse,
    ApproveRequest,
    ApproveResponse,
    ArtifactResponse,
    ArtifactUpdate,
)
from app.schemas.session import MessageResponse
from app.services.approval_message import write_approval_message
from app.services.approval_service import ApprovalError, get_last_approved
from app.services.approval_service import approve_artifact as approve_in_service
from app.services.artifact_templates import slot_for_type
from app.services.chat_events import (
    record_artifact_approved,
    record_artifact_deleted,
    record_artifact_saved,
)
from app.services.slot_service import SLOT_TYPES, reset_slot_artifact

router = APIRouter()


@router.get("", response_model=list[ArtifactResponse])
async def list_artifacts(
    project_id: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ArtifactResponse]:
    """List artifacts owned by the current user, optionally filtered by
    project and/or status."""
    stmt = (
        select(Artifact)
        .join(Project, Artifact.project_id == Project.id)
        .where(Project.owner_id == current_user.id)
    )
    if project_id:
        stmt = stmt.where(Artifact.project_id == project_id)
    if status:
        stmt = stmt.where(Artifact.status == status)
    stmt = stmt.order_by(Artifact.created_at.desc())
    result = await db.execute(stmt)
    return [_to_response(a) for a in result.scalars().all()]


@router.get("/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact(
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Get an artifact by ID."""
    artifact = await _get_owned_artifact(artifact_id, current_user.id, db)
    return _to_response(artifact)


@router.get("/{artifact_id}/approved-version", response_model=ApprovedVersionResponse)
async def get_approved_version(
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Last approved copy of an artifact; stays available after edits back to draft."""
    await _get_owned_artifact(artifact_id, current_user.id, db)
    version = await get_last_approved(db, artifact_id)
    if version is None:
        raise HTTPException(status_code=404, detail="No approved version")
    return version


@router.get("/{artifact_id}/download")
async def download_artifact(
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Download the artifact's current text as a Markdown file."""
    artifact = await _get_owned_artifact(artifact_id, current_user.id, db)
    if artifact.status == "not_started":
        raise conflict("not_started", "This artifact has not been started yet.")
    body = artifact.content.encode("utf-8")
    return Response(
        content=body,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{_download_filename(artifact)}"',
            "Content-Length": str(len(body)),
        },
    )


@router.put("/{artifact_id}", response_model=ArtifactResponse)
async def update_artifact(
    artifact_id: str,
    update: ArtifactUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Update an artifact in-place (manual user edit).

    - If content changes on an approved artifact the status resets to 'draft'.
    - If only the title changes the status is preserved.
    """
    artifact = await _get_owned_artifact(artifact_id, current_user.id, db)
    await require_unlocked(db, artifact.project_id)

    content_changed = update.content is not None and update.content != artifact.content

    if content_changed:
        artifact.reviewed_since_change = False
        if artifact.status == "approved":
            artifact.status = "draft"

    if update.title is not None:
        artifact.title = update.title
    if update.content is not None:
        artifact.content = update.content
    if update.language is not None:
        artifact.language = update.language
    if update.metadata is not None:
        artifact.metadata_ = update.metadata

    await db.flush()
    if content_changed:
        await record_artifact_saved(db, artifact)

    await db.refresh(artifact)
    return _to_response(artifact)


@router.post("/{artifact_id}/approve", response_model=ApproveResponse)
async def approve_artifact(
    artifact_id: str,
    body: ApproveRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Approve a draft: no open comments, reviewed (or force), stores the version copy.

    With `session_id` the next step is written into that chat and returned as `chat_message`.
    """
    artifact = await _get_owned_artifact(artifact_id, current_user.id, db)
    await require_unlocked(db, artifact.project_id)
    try:
        await approve_in_service(db, artifact, force=body.force if body else False)
    except ApprovalError as exc:
        raise conflict(exc.code, str(exc)) from exc
    await record_artifact_approved(db, artifact)
    message = await write_approval_message(db, artifact, body.session_id if body else None)
    await db.refresh(artifact)
    return ApproveResponse.model_validate(artifact).model_copy(
        update={
            "slot": slot_for_type(artifact.type),
            "chat_message": MessageResponse.model_validate(message) if message else None,
        }
    )


@router.delete("/{artifact_id}", status_code=204)
async def delete_artifact(
    artifact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete an artifact from draft or approved.

    Fixed slot artifacts (01-03) are reset to not_started (start over); others are removed.
    """
    artifact = await _get_owned_artifact(artifact_id, current_user.id, db)
    await require_unlocked(db, artifact.project_id)
    if artifact.type in SLOT_TYPES:
        await reset_slot_artifact(db, artifact)
        await record_artifact_deleted(db, artifact)
        return
    await db.delete(artifact)


def _download_filename(artifact: Artifact) -> str:
    """ASCII-only, header-safe name such as `01-project-description.md`."""
    stem = re.sub(r"[^a-z0-9]+", "-", artifact.title.lower()).strip("-") or "artifact"
    slot = slot_for_type(artifact.type)
    return f"{slot}-{stem}.md" if slot else f"{stem}.md"


def _to_response(artifact: Artifact) -> ArtifactResponse:
    return ArtifactResponse.model_validate(artifact).model_copy(
        update={"slot": slot_for_type(artifact.type)}
    )


async def _get_owned_artifact(artifact_id: str, owner_id: str, db: AsyncSession) -> Artifact:
    """Fetch artifact by ID and verify its project is owned by owner_id.

    Returns 404 for missing or foreign artifacts (no existence leak).
    """
    stmt = (
        select(Artifact)
        .join(Project, Artifact.project_id == Project.id)
        .where(Artifact.id == artifact_id, Project.owner_id == owner_id)
    )
    result = await db.execute(stmt)
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    return artifact
