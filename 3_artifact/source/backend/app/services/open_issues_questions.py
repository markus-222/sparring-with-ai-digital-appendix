"""Chat-added workshop questions go straight into artifact 03; list-only as fallback."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workshop_question import WorkshopQuestion
from app.services.artifact_templates import OPEN_ISSUES_ITEMS_END, heading_pattern
from app.services.chat_events import record_event
from app.services.run_lock import ProjectLockedError, assert_project_unlocked
from app.services.slot_service import ensure_slots, get_slot_artifact

QuestionBlocker = Literal["locked", "approved"]

_ITEMS_END = heading_pattern(OPEN_ISSUES_ITEMS_END)


class QuestionBlockedError(Exception):
    def __init__(self, code: QuestionBlocker) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class QuestionAdded:
    artifact_id: str
    start: int
    end: int
    created: bool
    count: int


async def save_question_to_list(
    db: AsyncSession, project_id: str, text: str, origin_artifact_id: str | None
) -> None:
    """Fallback while 03 cannot change: the next draft run for 03 receives the question."""
    db.add(
        WorkshopQuestion(project_id=project_id, text=text, origin_artifact_id=origin_artifact_id)
    )
    await db.flush()


def question_item(title: str, text: str) -> str:
    return f"### {title}\n\n**Question:** {text}"


def insert_questions(content: str, items: list[tuple[str, str]]) -> tuple[str, int, int]:
    """Add the items after the last item block (end of the artifact when it has none of the
    closing sections); the span covers all of them."""
    block = "\n\n".join(question_item(title, text) for title, text in items)
    match = _ITEMS_END.search(content)
    before, after = (content[: match.start()], content[match.start() :]) if match else (content, "")
    head = f"{before.rstrip()}\n\n" if before.strip() else ""
    tail = f"\n\n{after}" if after else "\n"
    return f"{head}{block}{tail}", len(head), len(head) + len(block)


def insert_question(content: str, title: str, text: str) -> tuple[str, int, int]:
    return insert_questions(content, [(title, text)])


async def add_questions_to_open_issues(
    db: AsyncSession,
    project_id: str,
    items: list[tuple[str, str]],
    origin_artifact_id: str | None,
    *,
    revoke_approval: bool = False,
) -> QuestionAdded:
    """Append the questions to 03 without touching what is already there.

    Questions whose text is already in 03 are skipped; count is 0 when nothing was new.
    """
    try:
        await assert_project_unlocked(db, project_id)
    except ProjectLockedError as exc:
        raise QuestionBlockedError("locked") from exc
    await ensure_slots(db, project_id)
    artifact = await get_slot_artifact(db, project_id, "03")
    if artifact.status == "approved" and not revoke_approval:
        raise QuestionBlockedError("approved")
    created = artifact.status == "not_started"
    new_items = [
        (title, text) for title, text in items if f"**Question:** {text}" not in artifact.content
    ]
    if not new_items:
        return QuestionAdded(artifact.id, 0, 0, created=False, count=0)
    artifact.content, start, end = insert_questions(artifact.content, new_items)
    artifact.status = "draft"
    artifact.reviewed_since_change = False
    for _, text in new_items:
        db.add(
            WorkshopQuestion(
                project_id=project_id, text=text, origin_artifact_id=origin_artifact_id
            )
        )
    await db.flush()
    await record_event(db, project_id, added_event_text(new_items))
    return QuestionAdded(artifact.id, start, end, created=created, count=len(new_items))


def added_event_text(items: list[tuple[str, str]]) -> str:
    titles = ", ".join(f"'{title}'" for title, _ in items)
    if len(items) == 1:
        return f"Analyst added a workshop question to 03: {titles}."
    return f"Analyst added {len(items)} workshop questions to 03: {titles}."
