"""The Analyst's chat tools against the database: every guard lives here, not in the prompt."""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.tool_loop import ToolOutcome
from app.models.artifact import Artifact
from app.models.comment import Comment
from app.models.message import Message
from app.schemas.chat import (
    ArtifactChangedEvent,
    ChatEvent,
    ChipClearedEvent,
    OpenArtifactEvent,
    ProposalSettledEvent,
    RunStartedEvent,
)
from app.schemas.proposal import QuestionProposal, read_proposal
from app.schemas.run import RunType, Slot
from app.services.approval_service import list_approved_foundation
from app.services.artifact_templates import TEMPLATES, get_template
from app.services.change_service import (
    ChangeError,
    ChangeResult,
    apply_chat_change,
    apply_chat_rewrite,
)
from app.services.chat_context import OpenArtifact
from app.services.comment_actions import mark_done_manually
from app.services.open_issues_questions import (
    QuestionBlockedError,
    add_questions_to_open_issues,
    save_question_to_list,
)
from app.services.question_proposals import new_proposal, settle_message
from app.services.run_lock import get_active_run
from app.services.run_manager import RunManager, RunStartError
from app.services.run_preconditions import RunPreconditionError, check_run_preconditions
from app.services.slot_service import SLOT_TYPES, ensure_slots, get_slot_artifact

RUN_ACTIVE = (
    "A background run is active. Changes are not possible until it has finished; nothing was "
    "changed. Tell the user and ask them to repeat the request afterwards."
)
EDITOR_OPEN = (
    "The user has unsaved edits open in the editor. Nothing was changed. "
    "Ask the user to save or discard them first."
)
NEEDS_CONFIRMATION = (
    "Artifact {slot} is approved. This would revoke the approval, so the user must confirm "
    "first. Nothing was changed. Ask the user in one sentence whether to continue; call the "
    "tool again with revoke_approval=true only after they said yes."
)
NOT_REGISTERED = (
    "Artifact {slot} is approved and the confirmation question was not registered before this "
    "call, so it counts from now. Nothing was changed. Ask the user once more, in one sentence, "
    "whether the approval of {slot} may be revoked; after their yes call the tool again with "
    "revoke_approval=true."
)
RUN_NOT_STARTED = "The run could not be started."
NO_CONTENT = "Artifact {slot} has no content yet. Nothing was changed."
GIVING_UP = "Error: giving up. Tell the user the change could not be applied."
CHANGE_ERROR_TEXTS: dict[str, str] = {
    "not_found": "The text to replace was not found. Use the exact text from the artifact.",
    "ambiguous": "The text to replace occurs more than once. Include more context.",
    "empty_find": "find must not be empty.",
    "locked": "A run is active.",
}
SECTION_ERROR_TEXTS: dict[str, str] = {
    "not_found": (
        "No section with this heading was found. Use the exact heading text from the artifact."
    ),
    "ambiguous": ("More than one section has this heading. Replace the enclosing section instead."),
    "empty_find": "heading must not be empty.",
    "locked": "A run is active.",
}
UNKNOWN_ARTIFACT = (
    "There is no artifact '{ref}'. Use 01, 02 or 03, or the id of a free-form artifact exactly "
    "as listed in <state>. Nothing was changed."
)
USE_START_DRAFT = " Use start_draft to write it."
REPLACED = "Replaced."
SECTION_REPLACED = "Section replaced."
ARTIFACT_REPLACED = "Artifact replaced."
APPROVAL_REVOKED = " The approval was revoked; the artifact is a draft again."
RESOLVE_QUESTION = (
    " A comment is attached to this chat ('{title}'). Ask the user whether it should be "
    "marked as resolved, unless they already said so."
)
NOT_STARTED = "Artifact {slot} ({title}) has not been started."
ARTIFACT_TEXT = "Artifact {slot} ({title}), status {status}.\n\n{content}"
FREE_ARTIFACT_TEXT = "Free-form artifact '{title}' (id {id}).\n\n{content}"
DRAFT_STARTED = (
    "Draft run for {slot} ({title}) started. It takes about one to two minutes and the "
    "artifact opens when it is done. Tell the user in one sentence."
)
LOWER_NOT_APPROVED = (
    " Note: {lower} is not approved, so the draft relies on the customer documents only."
)
REVIEW_STARTED = (
    "Review of {slot} ({title}) started. It takes about one to two minutes; the comments "
    "appear next to the artifact. Tell the user in one sentence."
)
ARTIFACT_CREATED = (
    "Created the artifact '{title}' (id {id}). It is plain Markdown with no required structure "
    "or automatic format check, and it opens next to the chat. Tell the user in one sentence."
)
PRECONDITION_TEXTS: dict[str, str] = {
    "not_draft": "There is no draft of {slot} to review.",
    "empty_draft": "The draft of {slot} is empty.",
    "open_comments": (
        "{slot} still has open comments. A review is only possible after they are resolved."
    ),
}
QUESTIONS_LISTED = (
    "A run is active, so the {count} question(s) were saved to the project's question list "
    "only. Artifact 03 receives them when it is drafted next. Tell the user."
)
QUESTIONS_KNOWN = "All of these questions are already in 03. Nothing was added."
QUESTIONS_ADDED = "Added {count} question(s) to 03."
QUESTIONS_CREATED = " 03 did not exist yet and was created."
CARD_SHOWN = (
    "A card with the {count} question(s) is shown below your reply; the user chooses there "
    "which ones to add. Do not repeat the questions in your text."
)
CARD_EXISTS = "A card is already shown for this reply."
NO_COMMENT = "No comment is attached to this chat."
COMMENT_RESOLVED_BEFORE = "The comment is already resolved."
COMMENT_RESOLVED = "Comment '{title}' is marked as resolved."

_MAX_FAILED_EDITS = 2
_SLOTS: dict[str, Slot] = {template.slot: template.slot for template in TEMPLATES}


@dataclass(frozen=True)
class _Target:
    artifact: Artifact
    slot: Slot | None  # None: a free-form artifact

    @property
    def label(self) -> str:
        return self.slot if self.slot is not None else f"'{self.artifact.title}'"


@dataclass
class TurnEffects:
    asked_slots: list[Slot] = field(default_factory=list)
    comment_question: bool = False  # an edit happened with a chip and the comment is still open
    proposal: QuestionProposal | None = None

    @property
    def pending(self) -> bool:
        return bool(self.asked_slots) or self.comment_question


class ChatToolbox:
    """One instance per chat turn: tool state, UI events and the effects the service reads."""

    def __init__(
        self,
        db: AsyncSession,
        run_manager: RunManager,
        *,
        session_id: str,
        project_id: str,
        open_artifact: OpenArtifact | None,
        chip: Comment | None,
        editor_open: bool,
        confirmable: frozenset[Slot],
    ) -> None:
        self._db = db
        self._run_manager = run_manager
        self._session_id = session_id
        self._project_id = project_id
        self._open = open_artifact
        self._chip = chip
        self._editor_open = editor_open
        self._confirmable = confirmable
        self._events: list[ChatEvent] = []
        self._failed_edits = 0
        self.effects = TurnEffects()

    def take_events(self) -> list[ChatEvent]:
        events, self._events = self._events, []
        return events

    # --- tools ---

    async def start_draft(
        self, slot: Slot, revoke_approval: bool, language: str | None = None
    ) -> ToolOutcome:
        if (refusal := await self._blocked()) is not None:
            return refusal
        artifact = await self._slot_artifact(slot)
        if (refusal := self._approval_guard(slot, artifact, revoke_approval)) is not None:
            return refusal
        started = DRAFT_STARTED.format(slot=slot, title=get_template(slot).title)
        started += await self._lower_notes(slot)
        return await self._start_run("draft", slot, started, language=language)

    async def start_review(self, slot: Slot) -> ToolOutcome:
        if (refusal := await self._blocked()) is not None:
            return refusal
        await ensure_slots(self._db, self._project_id)
        try:
            await check_run_preconditions(self._db, self._project_id, "review", slot)
        except RunPreconditionError as exc:
            return ToolOutcome(False, PRECONDITION_TEXTS[exc.code].format(slot=slot))
        started = REVIEW_STARTED.format(slot=slot, title=get_template(slot).title)
        return await self._start_run("review", slot, started)

    async def create_artifact(self, title: str, content: str) -> ToolOutcome:
        if (refusal := await self._blocked()) is not None:
            return refusal
        artifact = Artifact(
            project_id=self._project_id,
            type=f"free_{uuid.uuid4().hex}",
            title=title,
            content=content,
            status="draft",
        )
        self._db.add(artifact)
        await self._db.flush()
        self._show(artifact.id)
        return ToolOutcome(True, ARTIFACT_CREATED.format(title=title, id=artifact.id))

    async def read_artifact(self, artifact: str) -> ToolOutcome:
        target = await self._target(artifact)
        if isinstance(target, ToolOutcome):
            return target
        if target.slot is None:
            free = target.artifact
            return ToolOutcome(
                True,
                FREE_ARTIFACT_TEXT.format(title=free.title, id=free.id, content=free.content),
            )
        return await self._read_slot(target.slot, target.artifact)

    async def _read_slot(self, slot: Slot, artifact: Artifact) -> ToolOutcome:
        title = get_template(slot).title
        if artifact.status == "not_started":
            return ToolOutcome(True, NOT_STARTED.format(slot=slot, title=title))
        text = ARTIFACT_TEXT.format(
            slot=slot, title=title, status=artifact.status, content=artifact.content
        )
        comments = await self._open_comments(artifact.id)
        if comments:
            lines = "\n".join(f"- #{c.number} {c.title}: {c.description}" for c in comments)
            text += f"\n\nOpen comments:\n{lines}"
        return ToolOutcome(True, text)

    async def edit_artifact(
        self, artifact: str, find: str, replace: str, revoke_approval: bool
    ) -> ToolOutcome:
        target = await self._changeable(artifact, revoke_approval)
        if isinstance(target, ToolOutcome):
            return target
        if not target.artifact.content.strip():
            return ToolOutcome(False, NO_CONTENT.format(slot=target.label))
        try:
            result = await apply_chat_change(self._db, target.artifact, find, replace)
        except ChangeError as exc:
            self._failed_edits += 1
            return ToolOutcome(False, f"Error: {CHANGE_ERROR_TEXTS[exc.code]}")
        return self._changed(target.artifact, result, REPLACED)

    async def rewrite_artifact(
        self, artifact: str, content: str, heading: str | None, revoke_approval: bool
    ) -> ToolOutcome:
        target = await self._changeable(artifact, revoke_approval)
        if isinstance(target, ToolOutcome):
            return target
        if target.slot is not None and not target.artifact.content.strip():
            # A fixed artifact gets its first text from the draft run, never from the chat.
            return ToolOutcome(False, NO_CONTENT.format(slot=target.label) + USE_START_DRAFT)
        try:
            result = await apply_chat_rewrite(self._db, target.artifact, content, heading)
        except ChangeError as exc:
            self._failed_edits += 1
            return ToolOutcome(False, f"Error: {SECTION_ERROR_TEXTS[exc.code]}")
        done = ARTIFACT_REPLACED if heading is None else SECTION_REPLACED
        return self._changed(target.artifact, result, done)

    async def _changeable(self, ref: str, revoke_approval: bool) -> _Target | ToolOutcome:
        """The artifact a change tool may write to, or the refusal."""
        if (refusal := await self._blocked()) is not None:
            return refusal
        target = await self._target(ref)
        if isinstance(target, ToolOutcome):
            return target
        artifact = target.artifact
        if artifact.status == "not_started":
            return ToolOutcome(False, NO_CONTENT.format(slot=target.label))
        if target.slot is not None:
            refusal = self._approval_guard(target.slot, artifact, revoke_approval)
            if refusal is not None:
                return refusal
        if self._failed_edits >= _MAX_FAILED_EDITS:
            return ToolOutcome(False, GIVING_UP)
        return target

    def _changed(self, artifact: Artifact, result: ChangeResult, done: str) -> ToolOutcome:
        """Queue the UI events of an applied change and build its result text."""
        self._events.append(
            (
                "artifact_changed",
                ArtifactChangedEvent(artifact_id=artifact.id, start=result.start, end=result.end),
            )
        )
        self._show(artifact.id)
        text = done + (APPROVAL_REVOKED if result.was_approved else "")
        chip = self._chip
        if chip is not None and chip.artifact_id == artifact.id and chip.status == "open":
            self.effects.comment_question = True
            text += RESOLVE_QUESTION.format(title=chip.title)
        return ToolOutcome(True, text)

    async def add_workshop_questions(
        self, questions: list[tuple[str, str]], revoke_approval: bool
    ) -> ToolOutcome:
        if self._editor_open:
            return ToolOutcome(False, EDITOR_OPEN)
        origin_id = self._open.id if self._open is not None else None
        if await get_active_run(self._db, self._project_id) is not None:
            for _, text in questions:
                await save_question_to_list(self._db, self._project_id, text, origin_id)
            return ToolOutcome(True, QUESTIONS_LISTED.format(count=len(questions)))
        await ensure_slots(self._db, self._project_id)
        open_issues = await get_slot_artifact(self._db, self._project_id, "03")
        if (refusal := self._approval_guard("03", open_issues, revoke_approval)) is not None:
            return refusal
        try:
            added = await add_questions_to_open_issues(
                self._db,
                self._project_id,
                questions,
                origin_id,
                revoke_approval=open_issues.status == "approved",
            )
        except QuestionBlockedError as exc:
            # Only reachable when the state changed after the checks above.
            if exc.code == "locked":
                return ToolOutcome(False, RUN_ACTIVE)
            return self._ask_confirmation("03")
        if added.count == 0:
            return ToolOutcome(True, QUESTIONS_KNOWN)
        self._events.append(
            (
                "artifact_changed",
                ArtifactChangedEvent(
                    artifact_id=added.artifact_id, start=added.start, end=added.end
                ),
            )
        )
        self._show(added.artifact_id)
        await self._settle_card({text for _, text in questions})
        text = QUESTIONS_ADDED.format(count=added.count)
        return ToolOutcome(True, text + (QUESTIONS_CREATED if added.created else ""))

    async def propose_workshop_questions(self, questions: list[tuple[str, str]]) -> ToolOutcome:
        if self.effects.proposal is not None:
            return ToolOutcome(False, CARD_EXISTS)
        origin_id = self._open.id if self._open is not None else None
        self.effects.proposal = new_proposal(questions, origin_id)
        return ToolOutcome(True, CARD_SHOWN.format(count=len(questions)))

    async def resolve_comment(self) -> ToolOutcome:
        if self._chip is None:
            return ToolOutcome(False, NO_COMMENT)
        if (refusal := await self._blocked()) is not None:
            return refusal
        result = await self._db.execute(
            select(Comment)
            .where(Comment.id == self._chip.id)
            .execution_options(populate_existing=True)
        )
        comment = result.scalar_one_or_none()
        if comment is None or comment.status != "open":
            return ToolOutcome(True, COMMENT_RESOLVED_BEFORE)
        await mark_done_manually(self._db, comment)
        self._events.append(("chip_cleared", ChipClearedEvent()))
        self.effects.comment_question = False
        return ToolOutcome(True, COMMENT_RESOLVED.format(title=comment.title))

    # --- guards ---

    async def _blocked(self) -> ToolOutcome | None:
        """The refusal while a run is active or the user has unsaved edits open."""
        if await get_active_run(self._db, self._project_id) is not None:
            return ToolOutcome(False, RUN_ACTIVE)
        if self._editor_open:
            return ToolOutcome(False, EDITOR_OPEN)
        return None

    def _approval_guard(
        self, slot: Slot, artifact: Artifact, revoke_approval: bool
    ) -> ToolOutcome | None:
        """Changing an approved artifact needs a yes the user gave after being asked."""
        if artifact.status != "approved":
            return None
        if revoke_approval and slot in self._confirmable:
            return None
        return self._ask_confirmation(slot, flag_sent=revoke_approval)

    def _ask_confirmation(self, slot: Slot, *, flag_sent: bool = False) -> ToolOutcome:
        """Register the question for `slot`; `flag_sent=True` means the model skipped asking."""
        if slot not in self.effects.asked_slots:
            self.effects.asked_slots.append(slot)
        text = NOT_REGISTERED if flag_sent else NEEDS_CONFIRMATION
        return ToolOutcome(False, text.format(slot=slot))

    # --- helpers ---

    async def _target(self, ref: str) -> _Target | ToolOutcome:
        """Resolve a slot or the id of one of this project's free-form artifacts."""
        slot = _SLOTS.get(ref)
        if slot is not None:
            return _Target(await self._slot_artifact(slot), slot)
        result = await self._db.execute(
            select(Artifact).where(
                Artifact.id == ref,
                Artifact.project_id == self._project_id,
                Artifact.type.not_in(SLOT_TYPES),
            )
        )
        artifact = result.scalar_one_or_none()
        if artifact is None:
            return ToolOutcome(False, UNKNOWN_ARTIFACT.format(ref=ref))
        return _Target(artifact, None)

    async def _slot_artifact(self, slot: Slot) -> Artifact:
        await ensure_slots(self._db, self._project_id)
        return await get_slot_artifact(self._db, self._project_id, slot)

    async def _open_comments(self, artifact_id: str) -> list[Comment]:
        result = await self._db.execute(
            select(Comment)
            .where(Comment.artifact_id == artifact_id, Comment.status == "open")
            .order_by(Comment.number)
        )
        return list(result.scalars().all())

    def _show(self, artifact_id: str) -> None:
        """Open the artifact next to the chat unless it is already open."""
        if self._open is not None and self._open.id == artifact_id:
            return
        self._events.append(("open_artifact", OpenArtifactEvent(artifact_id=artifact_id)))
        if self._chip is not None:
            self._events.append(("chip_cleared", ChipClearedEvent()))

    async def _lower_notes(self, slot: Slot) -> str:
        approved = {
            item.type for item in await list_approved_foundation(self._db, self._project_id)
        }
        return "".join(
            LOWER_NOT_APPROVED.format(lower=template.slot)
            for template in TEMPLATES
            if template.slot < slot and template.type not in approved
        )

    async def _start_run(
        self, run_type: RunType, slot: Slot, started: str, *, language: str | None = None
    ) -> ToolOutcome:
        # The worker uses its own DB session: what this turn did so far must be durable first.
        await self._db.commit()
        try:
            run = await self._run_manager.start(self._project_id, run_type, slot, language=language)
        except RunStartError as exc:
            return ToolOutcome(False, RUN_ACTIVE if exc.code == "run_active" else RUN_NOT_STARTED)
        self._events.append(("run_started", RunStartedEvent(run_id=run.id)))
        return ToolOutcome(True, started)

    async def _settle_card(self, texts: set[str]) -> None:
        """Mark the questions of the newest open card that were just added as accepted."""
        result = await self._db.execute(
            select(Message)
            .where(Message.session_id == self._session_id, Message.proposal.is_not(None))
            .order_by(Message.created_at.desc(), Message.id)
        )
        for message in result.scalars().all():
            proposal = read_proposal(message.proposal)
            if proposal is None or proposal.status != "open":
                continue
            ids = {q.id for q in proposal.questions if q.text in texts}
            if ids:
                settled = await settle_message(self._db, message, ids)
                self._events.append(
                    (
                        "proposal_settled",
                        ProposalSettledEvent(message_id=message.id, proposal=settled),
                    )
                )
            return
