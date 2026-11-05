"""Analyst chat tools: argument models, JSON schemas and the adapter to the ChatTools protocol.

The agents layer only knows the narrow protocol below; the service layer implements it
against the database and enforces every guard.
"""

from typing import Any, Protocol

from pydantic import AliasChoices, BaseModel, Field

from app.agents.tool_loop import ToolOutcome, ToolSpec
from app.schemas.run import Slot

_TITLE_LIMIT = 60
_LANGUAGE_LIMIT = 40
_EMPTY_QUESTION = "Error: the question text must not be empty."
_EMPTY_TITLE = "Error: the title must not be empty."
_EMPTY_CONTENT = "Error: content must not be empty when the whole artifact is replaced."


class ChatTools(Protocol):
    async def start_draft(
        self, slot: Slot, revoke_approval: bool, language: str | None = None
    ) -> ToolOutcome: ...

    async def start_review(self, slot: Slot) -> ToolOutcome: ...

    # `artifact` is a slot ("01", "02", "03") or the id of a free-form artifact.
    async def read_artifact(self, artifact: str) -> ToolOutcome: ...

    async def edit_artifact(
        self, artifact: str, find: str, replace: str, revoke_approval: bool
    ) -> ToolOutcome: ...

    async def rewrite_artifact(
        self, artifact: str, content: str, heading: str | None, revoke_approval: bool
    ) -> ToolOutcome: ...

    async def create_artifact(self, title: str, content: str) -> ToolOutcome: ...

    async def add_workshop_questions(
        self, questions: list[tuple[str, str]], revoke_approval: bool
    ) -> ToolOutcome: ...

    async def propose_workshop_questions(self, questions: list[tuple[str, str]]) -> ToolOutcome: ...

    async def resolve_comment(self) -> ToolOutcome: ...


def question_title(title: str | None, text: str) -> str:
    """Single-line item title; falls back to the start of the question."""
    flat = " ".join((title or "").split()).lstrip("#").strip()
    if flat:
        return flat
    words = " ".join(text.split())
    return words if len(words) <= _TITLE_LIMIT else f"{words[: _TITLE_LIMIT - 1]}…"


class SlotArgs(BaseModel):
    slot: Slot


class StartDraftArgs(BaseModel):
    slot: Slot
    revoke_approval: bool = False
    language: str | None = Field(default=None, max_length=_LANGUAGE_LIMIT)


class ArtifactArgs(BaseModel):
    # "slot" is the name these tools used before free-form artifacts became addressable.
    artifact: str = Field(min_length=1, validation_alias=AliasChoices("artifact", "slot"))


class EditArgs(ArtifactArgs):
    find: str
    replace: str
    revoke_approval: bool = False


class RewriteArgs(ArtifactArgs):
    content: str
    heading: str | None = None
    revoke_approval: bool = False


class CreateArtifactArgs(BaseModel):
    title: str
    content: str = ""


class QuestionArg(BaseModel):
    text: str
    title: str | None = None


class ProposeQuestionsArgs(BaseModel):
    questions: list[QuestionArg] = Field(min_length=1, max_length=12)


class AddQuestionsArgs(BaseModel):
    questions: list[QuestionArg] = Field(min_length=1, max_length=12)
    revoke_approval: bool = False


class NoArgs(BaseModel):
    pass


_SLOT: dict[str, Any] = {"type": "string", "enum": ["01", "02", "03"]}
_ARTIFACT: dict[str, Any] = {
    "type": "string",
    "description": (
        'Which artifact: "01", "02" or "03" for the three fixed artifacts, or the id of a '
        "free-form artifact exactly as listed in <state>."
    ),
}
_LANGUAGE: dict[str, Any] = {
    "type": "string",
    "maxLength": _LANGUAGE_LIMIT,
    "description": (
        'The language the user writes in, as an English name such as "German" or "English". '
        "The draft is written in this language."
    ),
}
_REVOKE_APPROVAL: dict[str, Any] = {
    "type": "boolean",
    "description": (
        "Set to true only after the user confirmed, in reply to your question, that the "
        "approval of this approved artifact may be revoked."
    ),
}
_QUESTIONS: dict[str, Any] = {
    "type": "array",
    "minItems": 1,
    "maxItems": 12,
    "items": {
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": (
                    "The workshop question, in the language the user writes in, as one "
                    "self-contained sentence."
                ),
            },
            "title": {
                "type": "string",
                "description": (
                    "A short title (at most 8 words) for the question's topic, in the same "
                    "language as the question."
                ),
            },
        },
        "required": ["text"],
    },
}


def _object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _question_items(questions: list[QuestionArg]) -> list[tuple[str, str]]:
    """(title, text) pairs; questions without text are dropped."""
    items: list[tuple[str, str]] = []
    for question in questions:
        text = question.text.strip()
        if text:
            items.append((question_title(question.title, text), text))
    return items


def build_tool_specs(tools: ChatTools, *, with_comment: bool) -> list[ToolSpec]:
    async def start_draft(args: StartDraftArgs) -> ToolOutcome:
        language = " ".join((args.language or "").split()) or None
        return await tools.start_draft(args.slot, args.revoke_approval, language)

    async def start_review(args: SlotArgs) -> ToolOutcome:
        return await tools.start_review(args.slot)

    async def read_artifact(args: ArtifactArgs) -> ToolOutcome:
        return await tools.read_artifact(args.artifact.strip())

    async def edit_artifact(args: EditArgs) -> ToolOutcome:
        return await tools.edit_artifact(
            args.artifact.strip(), args.find, args.replace, args.revoke_approval
        )

    async def rewrite_artifact(args: RewriteArgs) -> ToolOutcome:
        heading = (args.heading or "").strip() or None
        if heading is None and not args.content.strip():
            return ToolOutcome(False, _EMPTY_CONTENT)
        return await tools.rewrite_artifact(
            args.artifact.strip(), args.content, heading, args.revoke_approval
        )

    async def create_artifact(args: CreateArtifactArgs) -> ToolOutcome:
        title = args.title.strip()
        if not title:
            return ToolOutcome(False, _EMPTY_TITLE)
        return await tools.create_artifact(title, args.content)

    async def add_workshop_questions(args: AddQuestionsArgs) -> ToolOutcome:
        items = _question_items(args.questions)
        if not items:
            return ToolOutcome(False, _EMPTY_QUESTION)
        return await tools.add_workshop_questions(items, args.revoke_approval)

    async def propose_workshop_questions(args: ProposeQuestionsArgs) -> ToolOutcome:
        items = _question_items(args.questions)
        if not items:
            return ToolOutcome(False, _EMPTY_QUESTION)
        return await tools.propose_workshop_questions(items)

    async def resolve_comment(_: NoArgs) -> ToolOutcome:
        return await tools.resolve_comment()

    specs = [
        ToolSpec(
            "start_draft",
            "Start the background run that writes or rewrites the draft of an artifact. "
            "Use it when the user asks to create, draft, re-create or update a whole artifact. "
            "If the artifact already has content, the run merges it with new findings. "
            "The run takes about one to two minutes; the artifact opens by itself when it is "
            "done.",
            _object(
                {"slot": _SLOT, "language": _LANGUAGE, "revoke_approval": _REVOKE_APPROVAL},
                ["slot", "language"],
            ),
            StartDraftArgs,
            start_draft,
        ),
        ToolSpec(
            "start_review",
            "Start the background review of an artifact draft: Reviewer and Explorer write "
            "comments. Use it when the user asks to review or check a draft.",
            _object({"slot": _SLOT}, ["slot"]),
            SlotArgs,
            start_review,
        ),
        ToolSpec(
            "read_artifact",
            "Return the current text, status and open comments of an artifact, fixed or "
            "free-form. Use it before you change an artifact that is not the open one; the "
            "user may have edited it since you last saw it. A draft you read this way is not "
            "a source for project facts.",
            _object({"artifact": _ARTIFACT}, ["artifact"]),
            ArtifactArgs,
            read_artifact,
        ),
        ToolSpec(
            "edit_artifact",
            "Replace exactly one passage in an artifact, fixed or free-form. `find` is copied "
            "exactly from the current artifact text and must occur exactly once; `replace` is "
            "the new text (empty to delete the passage). One call per passage. Use it for a "
            "small, local change the user asked for or agreed to; for a larger change use "
            "rewrite_artifact.",
            _object(
                {
                    "artifact": _ARTIFACT,
                    "find": {"type": "string"},
                    "replace": {"type": "string"},
                    "revoke_approval": _REVOKE_APPROVAL,
                },
                ["artifact", "find", "replace"],
            ),
            EditArgs,
            edit_artifact,
        ),
        ToolSpec(
            "rewrite_artifact",
            "Replace a whole section of an artifact, or its whole text, with new Markdown; "
            "you write only the new text and copy nothing. Use it when a change touches a "
            "section or the artifact as a whole (shorten, restructure, merge or drop several "
            "items). With `heading`, the section under that heading is replaced: `content` "
            "starts with the section's heading line and contains the complete new section, "
            "subsections included (empty `content` deletes the section). Without `heading`, "
            "`content` replaces the whole artifact. Prefer one call per section when only "
            "some sections change. Everything you leave out is deleted, so keep what the "
            "user did not ask to change. Use it only for a change the user asked for or "
            "agreed to.",
            _object(
                {
                    "artifact": _ARTIFACT,
                    "content": {
                        "type": "string",
                        "description": "The complete new Markdown of the section or artifact.",
                    },
                    "heading": {
                        "type": "string",
                        "description": (
                            "Text of the heading of the section to replace, copied from the "
                            "artifact, with or without the leading #. Omit it to replace the "
                            "whole artifact."
                        ),
                    },
                    "revoke_approval": _REVOKE_APPROVAL,
                },
                ["artifact", "content"],
            ),
            RewriteArgs,
            rewrite_artifact,
        ),
        ToolSpec(
            "create_artifact",
            "Create a new, free-form artifact that is not one of the three fixed artifacts "
            "(01 Project Description, 02 Stakeholder Analysis, 03 Open Issues & Workshop "
            "Questions) — use start_draft for those instead. Use this only when the user "
            "explicitly asks for an additional artifact or note of their own (e.g. a meeting "
            "summary, a custom list). The content is saved as-is, in Markdown, with no required "
            "structure and no automatic format check. It opens immediately next to the chat; "
            "the user can keep editing it there or in the editor. It never has a slot, so no "
            "draft/review run and no automatic re-creation apply to it. To change an existing "
            "free-form artifact use edit_artifact or rewrite_artifact with its id; never "
            "create a second copy for a revision.",
            _object(
                {
                    "title": {"type": "string", "description": "Short title for the artifact."},
                    "content": {
                        "type": "string",
                        "description": "Initial Markdown content; may be empty.",
                    },
                },
                ["title"],
            ),
            CreateArtifactArgs,
            create_artifact,
        ),
        ToolSpec(
            "add_workshop_questions",
            "Append questions to artifact 03 (it is created if it does not exist yet). "
            "Use it only when the user asks to note, save or add questions, or agrees to "
            "questions you suggested.",
            _object({"questions": _QUESTIONS, "revoke_approval": _REVOKE_APPROVAL}, ["questions"]),
            AddQuestionsArgs,
            add_workshop_questions,
        ),
        ToolSpec(
            "propose_workshop_questions",
            "Show a card with suggested workshop questions; the user picks there which ones "
            "go into 03. Use it only when the user asks you to suggest or collect workshop "
            "questions. Nothing is saved by this call.",
            _object({"questions": _QUESTIONS}, ["questions"]),
            ProposeQuestionsArgs,
            propose_workshop_questions,
        ),
    ]
    if with_comment:
        specs.append(
            ToolSpec(
                "resolve_comment",
                "Mark the comment attached to this chat (see <chip>) as resolved. "
                "Use it only when the user says so or confirms your question.",
                _object({}, []),
                NoArgs,
                resolve_comment,
            )
        )
    return specs


TOOL_STATUS: dict[str, str] = {
    "start_draft": "Starting the draft…",
    "start_review": "Starting the review…",
    "read_artifact": "Reading the artifact…",
    "edit_artifact": "Changing the artifact…",
    "rewrite_artifact": "Rewriting the artifact…",
    "create_artifact": "Creating the artifact…",
    "add_workshop_questions": "Adding the workshop questions…",
    "propose_workshop_questions": "Preparing workshop questions…",
    "resolve_comment": "Resolving the comment…",
}
