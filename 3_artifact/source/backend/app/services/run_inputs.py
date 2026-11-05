"""Read-only input builders for the draft and review runs."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.document import Document
from app.models.workshop_question import WorkshopQuestion
from app.schemas.run import Slot
from app.services.approval_service import ApprovedArtifact, list_approved_foundation
from app.services.artifact_templates import TEMPLATES, get_template
from app.services.markers import extract_markers

_SLOT_ORDER = {template.slot: index for index, template in enumerate(TEMPLATES)}
_SLOT_BY_TYPE = {template.type: template.slot for template in TEMPLATES}


@dataclass(frozen=True)
class RunInputs:
    text: str
    known_documents: frozenset[str]


async def load_documents(db: AsyncSession, project_id: str) -> list[Document]:
    result = await db.execute(
        select(Document)
        .where(Document.project_id == project_id)
        .order_by(Document.created_at, Document.filename)
    )
    return list(result.scalars().all())


def _lower_foundation(foundation: list[ApprovedArtifact], slot: Slot) -> list[ApprovedArtifact]:
    return [a for a in foundation if _SLOT_ORDER[_SLOT_BY_TYPE[a.type]] < _SLOT_ORDER[slot]]


async def build_inputs(
    db: AsyncSession,
    project_id: str,
    slot: Slot,
    *,
    for_draft: bool,
    existing_draft: str = "",
) -> RunInputs:
    documents = [d for d in await load_documents(db, project_id) if d.full_text]
    parts = [f'<document name="{d.filename}">\n{d.full_text}\n</document>' for d in documents]
    foundation = _lower_foundation(await list_approved_foundation(db, project_id), slot)
    for item in foundation:
        parts.append(
            f'<approved_artifact slot="{_SLOT_BY_TYPE[item.type]}" type="{item.type}" '
            f'version="{item.version_no}">\n'
            f"{item.content}\n</approved_artifact>"
        )
    if for_draft and slot == "03":
        parts += await _open_issue_inputs(db, project_id, foundation)
    if for_draft and existing_draft.strip():
        parts.append(f"<existing_draft>\n{existing_draft.strip()}\n</existing_draft>")
    parts.append(f'<target_artifact slot="{slot}" title="{get_template(slot).title}"/>')
    return RunInputs(
        text="\n\n".join(parts),
        known_documents=frozenset(d.filename for d in documents),
    )


async def _open_issue_inputs(
    db: AsyncSession, project_id: str, foundation: list[ApprovedArtifact]
) -> list[str]:
    parts: list[str] = []
    question_rows = await db.execute(
        select(WorkshopQuestion)
        .where(WorkshopQuestion.project_id == project_id)
        .order_by(WorkshopQuestion.created_at)
    )
    questions = question_rows.scalars().all()
    if questions:
        lines = "\n".join(f"- {q.text}" for q in questions)
        parts.append(f"<workshop_questions>\n{lines}\n</workshop_questions>")
    markers = [
        f"[{_SLOT_BY_TYPE[item.type]}] {line}"
        for item in foundation
        for line in extract_markers(item.content)
    ]
    if markers:
        parts.append("<markers>\n" + "\n".join(markers) + "\n</markers>")
    rejected_rows = await db.execute(
        select(Comment)
        .join(Artifact, Comment.artifact_id == Artifact.id)
        .where(Artifact.project_id == project_id, Comment.status == "rejected")
        .order_by(Comment.created_at, Comment.number)
    )
    rejected = rejected_rows.scalars().all()
    if rejected:
        lines = "\n".join(f"- {c.title}: {c.description}" for c in rejected)
        parts.append(
            f"<rejected_comments>\nDo not include these points:\n{lines}\n</rejected_comments>"
        )
    return parts


async def build_resolved_findings(db: AsyncSession, artifact_id: str) -> str:
    result = await db.execute(
        select(Comment)
        .where(Comment.artifact_id == artifact_id, Comment.status != "open")
        .order_by(Comment.number)
    )
    comments = result.scalars().all()
    return "\n".join(f"- [{c.status}] {c.title} — {c.description}" for c in comments)
