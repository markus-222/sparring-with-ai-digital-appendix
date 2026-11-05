"""Analyst chat tools: specs, argument validation and forwarding to the ChatTools protocol."""

import json
from typing import Any

import pytest
from pydantic import ValidationError

from app.agents.chat_tools import TOOL_STATUS, ChatTools, build_tool_specs, question_title
from app.agents.tool_loop import ToolOutcome, ToolSpec
from app.schemas.run import Slot

ALL_TOOLS = {
    "start_draft",
    "start_review",
    "read_artifact",
    "edit_artifact",
    "rewrite_artifact",
    "create_artifact",
    "add_workshop_questions",
    "propose_workshop_questions",
    "resolve_comment",
}


class RecordingTools:
    """Satisfies ChatTools; remembers every call."""

    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []

    async def start_draft(
        self, slot: Slot, revoke_approval: bool, language: str | None = None
    ) -> ToolOutcome:
        self.calls.append(("start_draft", slot, revoke_approval, language))
        return ToolOutcome(True, "draft started")

    async def start_review(self, slot: Slot) -> ToolOutcome:
        self.calls.append(("start_review", slot))
        return ToolOutcome(True, "review started")

    async def read_artifact(self, artifact: str) -> ToolOutcome:
        self.calls.append(("read_artifact", artifact))
        return ToolOutcome(True, "text")

    async def edit_artifact(
        self, artifact: str, find: str, replace: str, revoke_approval: bool
    ) -> ToolOutcome:
        self.calls.append(("edit_artifact", artifact, find, replace, revoke_approval))
        return ToolOutcome(True, "replaced")

    async def rewrite_artifact(
        self, artifact: str, content: str, heading: str | None, revoke_approval: bool
    ) -> ToolOutcome:
        self.calls.append(("rewrite_artifact", artifact, content, heading, revoke_approval))
        return ToolOutcome(True, "rewritten")

    async def create_artifact(self, title: str, content: str) -> ToolOutcome:
        self.calls.append(("create_artifact", title, content))
        return ToolOutcome(True, "created")

    async def add_workshop_questions(
        self, questions: list[tuple[str, str]], revoke_approval: bool
    ) -> ToolOutcome:
        self.calls.append(("add_workshop_questions", questions, revoke_approval))
        return ToolOutcome(True, "added")

    async def propose_workshop_questions(self, questions: list[tuple[str, str]]) -> ToolOutcome:
        self.calls.append(("propose_workshop_questions", questions))
        return ToolOutcome(True, "proposed")

    async def resolve_comment(self) -> ToolOutcome:
        self.calls.append(("resolve_comment",))
        return ToolOutcome(True, "resolved")


def _specs(tools: ChatTools, *, with_comment: bool = True) -> dict[str, ToolSpec]:
    return {spec.name: spec for spec in build_tool_specs(tools, with_comment=with_comment)}


async def _call(tools: ChatTools, name: str, arguments: str) -> ToolOutcome:
    spec = _specs(tools)[name]
    return await spec.handler(spec.args_model.model_validate_json(arguments))


def test_every_tool_has_a_description_and_an_object_schema() -> None:
    specs = _specs(RecordingTools())

    assert set(specs) == ALL_TOOLS
    for spec in specs.values():
        assert spec.description
        assert spec.parameters["type"] == "object"


@pytest.mark.parametrize(
    ("name", "required"),
    [
        ("start_draft", ["slot", "language"]),
        ("start_review", ["slot"]),
        ("read_artifact", ["artifact"]),
        ("edit_artifact", ["artifact", "find", "replace"]),
        ("rewrite_artifact", ["artifact", "content"]),
        ("create_artifact", ["title"]),
        ("add_workshop_questions", ["questions"]),
        ("propose_workshop_questions", ["questions"]),
        ("resolve_comment", []),
    ],
)
def test_schemas_require_the_documented_fields(name: str, required: list[str]) -> None:
    parameters = _specs(RecordingTools())[name].parameters

    assert parameters.get("required", []) == required


@pytest.mark.parametrize("name", ["start_draft", "start_review"])
def test_slot_is_limited_to_the_three_slots(name: str) -> None:
    properties = _specs(RecordingTools())[name].parameters["properties"]

    assert properties["slot"] == {"type": "string", "enum": ["01", "02", "03"]}


@pytest.mark.parametrize("name", ["read_artifact", "edit_artifact", "rewrite_artifact"])
def test_artifact_tools_take_a_slot_or_a_free_artifact_id(name: str) -> None:
    properties = _specs(RecordingTools())[name].parameters["properties"]

    assert properties["artifact"]["type"] == "string"
    assert "enum" not in properties["artifact"]
    assert "slot" not in properties


def test_the_three_changing_tools_describe_the_revoke_flag_alike() -> None:
    specs = _specs(RecordingTools())
    descriptions = {
        specs[name].parameters["properties"]["revoke_approval"]["description"]
        for name in ("start_draft", "edit_artifact", "add_workshop_questions")
    }

    assert len(descriptions) == 1
    assert "after the user confirmed" in descriptions.pop()
    assert (
        "revoke_approval" not in _specs(RecordingTools())["start_review"].parameters["properties"]
    )


def test_question_items_are_limited_to_twelve_with_a_required_text() -> None:
    parameters = _specs(RecordingTools())["propose_workshop_questions"].parameters
    questions = parameters["properties"]["questions"]

    assert (questions["minItems"], questions["maxItems"]) == (1, 12)
    assert questions["items"]["required"] == ["text"]


def test_resolve_comment_is_only_offered_with_a_comment() -> None:
    assert "resolve_comment" not in _specs(RecordingTools(), with_comment=False)
    assert set(_specs(RecordingTools(), with_comment=False)) == ALL_TOOLS - {"resolve_comment"}
    assert "resolve_comment" in _specs(RecordingTools(), with_comment=True)


def test_every_tool_has_a_status_line() -> None:
    assert set(TOOL_STATUS) == ALL_TOOLS


@pytest.mark.parametrize(
    ("name", "arguments", "expected"),
    [
        ("start_draft", '{"slot": "02"}', ("start_draft", "02", False, None)),
        (
            "start_draft",
            '{"slot": "01", "revoke_approval": true, "language": " English "}',
            ("start_draft", "01", True, "English"),
        ),
        ("start_review", '{"slot": "03"}', ("start_review", "03")),
        ("read_artifact", '{"slot": "01"}', ("read_artifact", "01")),
        ("read_artifact", '{"artifact": " abc-1 "}', ("read_artifact", "abc-1")),
        (
            "edit_artifact",
            '{"artifact": "abc-1", "find": "a", "replace": "b"}',
            ("edit_artifact", "abc-1", "a", "b", False),
        ),
        (
            "rewrite_artifact",
            '{"artifact": "03", "content": "# New"}',
            ("rewrite_artifact", "03", "# New", None, False),
        ),
        (
            "rewrite_artifact",
            '{"artifact": "abc-1", "content": "", "heading": " ## Scope ", '
            '"revoke_approval": true}',
            ("rewrite_artifact", "abc-1", "", "## Scope", True),
        ),
        (
            "edit_artifact",
            '{"slot": "01", "find": "a", "replace": "b"}',
            ("edit_artifact", "01", "a", "b", False),
        ),
        (
            "edit_artifact",
            '{"slot": "02", "find": "a", "replace": "", "revoke_approval": true}',
            ("edit_artifact", "02", "a", "", True),
        ),
        (
            "create_artifact",
            '{"title": "Meeting notes"}',
            ("create_artifact", "Meeting notes", ""),
        ),
        (
            "create_artifact",
            '{"title": "Meeting notes", "content": "# Notes"}',
            ("create_artifact", "Meeting notes", "# Notes"),
        ),
        (
            "add_workshop_questions",
            '{"questions": [{"text": " Wer zahlt? ", "title": "Budget"}], "revoke_approval": true}',
            ("add_workshop_questions", [("Budget", "Wer zahlt?")], True),
        ),
        (
            "propose_workshop_questions",
            '{"questions": [{"text": "Wer zahlt?", "title": "Budget"}]}',
            ("propose_workshop_questions", [("Budget", "Wer zahlt?")]),
        ),
        ("resolve_comment", "{}", ("resolve_comment",)),
    ],
)
async def test_handlers_forward_the_validated_arguments(
    name: str, arguments: str, expected: tuple[Any, ...]
) -> None:
    tools = RecordingTools()

    outcome = await _call(tools, name, arguments)

    assert tools.calls == [expected]
    assert outcome.ok


@pytest.mark.parametrize("name", ["add_workshop_questions", "propose_workshop_questions"])
async def test_a_missing_title_falls_back_to_the_start_of_the_question(name: str) -> None:
    tools = RecordingTools()
    text = "Welche Systeme sind heute im Einsatz und wer betreibt sie im Alltag wirklich?"
    questions = [{"text": text}, {"text": "Wer?", "title": "  "}]

    await _call(tools, name, json.dumps({"questions": questions}))

    forwarded = tools.calls[0][1]
    assert forwarded[0] == (question_title(None, text), text)
    assert forwarded[0][0].endswith("…")
    assert forwarded[1] == ("Wer?", "Wer?")


@pytest.mark.parametrize("name", ["add_workshop_questions", "propose_workshop_questions"])
async def test_blank_questions_are_dropped(name: str) -> None:
    tools = RecordingTools()

    await _call(tools, name, '{"questions": [{"text": "  "}, {"text": "Wer?", "title": "A"}]}')

    assert tools.calls[0][1] == [("A", "Wer?")]


@pytest.mark.parametrize("name", ["add_workshop_questions", "propose_workshop_questions"])
async def test_only_blank_questions_are_refused_without_calling_the_tools(name: str) -> None:
    tools = RecordingTools()

    outcome = await _call(tools, name, '{"questions": [{"text": " "}, {"text": ""}]}')

    assert outcome == ToolOutcome(False, "Error: the question text must not be empty.")
    assert tools.calls == []


async def test_a_blank_title_is_refused_without_calling_the_tool() -> None:
    tools = RecordingTools()

    outcome = await _call(tools, "create_artifact", '{"title": "   "}')

    assert outcome == ToolOutcome(False, "Error: the title must not be empty.")
    assert tools.calls == []


@pytest.mark.parametrize("name", ["add_workshop_questions", "propose_workshop_questions"])
def test_between_one_and_twelve_questions_are_valid(name: str) -> None:
    model = _specs(RecordingTools())[name].args_model
    item = '{"text": "Wer?"}'

    model.model_validate_json(f'{{"questions": [{", ".join([item] * 12)}]}}')
    with pytest.raises(ValidationError):
        model.model_validate_json(f'{{"questions": [{", ".join([item] * 13)}]}}')
    with pytest.raises(ValidationError):
        model.model_validate_json('{"questions": []}')


@pytest.mark.parametrize(
    ("name", "arguments"),
    [
        ("start_draft", '{"slot": "04"}'),
        ("start_review", '{"slot": "1"}'),
        ("read_artifact", '{"slot": 1}'),
        ("read_artifact", '{"artifact": ""}'),
        ("edit_artifact", '{"find": "a", "replace": "b"}'),
        ("rewrite_artifact", '{"artifact": "01"}'),
    ],
)
def test_an_invalid_slot_fails_validation(name: str, arguments: str) -> None:
    with pytest.raises(ValidationError):
        _specs(RecordingTools())[name].args_model.model_validate_json(arguments)


@pytest.mark.parametrize("content", ["", " \n"])
async def test_replacing_a_whole_artifact_with_nothing_is_refused(content: str) -> None:
    tools = RecordingTools()

    outcome = await _call(
        tools, "rewrite_artifact", json.dumps({"artifact": "01", "content": content})
    )

    assert tools.calls == []
    assert outcome == ToolOutcome(
        False, "Error: content must not be empty when the whole artifact is replaced."
    )


def test_question_title_is_a_single_line_with_a_fallback() -> None:
    assert question_title("  ## Budget\nfrage ", "text") == "Budget frage"
    assert question_title(None, "Wer  zahlt\nden Lauf?") == "Wer zahlt den Lauf?"
    long = question_title("", "wort " * 30)
    assert len(long) == 60
    assert long.endswith("…")
