"""Chat prompt assembly: blocks, history expansion and the cache layout. Pure, no DB, no LLM."""

import copy
import json
from collections.abc import Sequence
from typing import Any

import pytest

from app.models.comment import Comment
from app.models.document import Document
from app.services.approval_service import ApprovedArtifact
from app.services.chat_context import OpenArtifact
from app.services.chat_prompt import (
    HistoryRow,
    approved_block,
    build_messages,
    documents_block,
    expand_history,
    turn_block,
)

EPHEMERAL = {"type": "ephemeral"}


def _document(filename: str, full_text: str | None) -> Document:
    return Document(
        project_id="p",
        filename=filename,
        content_type="text/markdown",
        size_bytes=1,
        full_text=full_text,
    )


def _comment(
    number: int, title: str, description: str, suggestion: dict[str, Any] | None = None
) -> Comment:
    return Comment(
        id=f"c{number}",
        artifact_id="a1",
        number=number,
        review_number=1,
        title=title,
        description=description,
        suggestion=suggestion,
    )


def _approved(
    type_: str, version_no: int, content: str, current_status: str = "approved"
) -> ApprovedArtifact:
    return ApprovedArtifact(
        artifact_id=f"id-{type_}",
        type=type_,
        title=type_,
        version_no=version_no,
        content=content,
        current_status=current_status,
    )


def _open_artifact(
    status: str = "draft",
    content: str = "## Problem\nOffers take long.\n",
    comments: Sequence[Comment] = (),
) -> OpenArtifact:
    return OpenArtifact(
        id="a1", slot="01", status=status, content=content, open_comments=list(comments)
    )


def _count_markers(value: object) -> int:
    if isinstance(value, dict):
        own = 1 if "cache_control" in value else 0
        return own + sum(_count_markers(item) for item in value.values())
    if isinstance(value, list):
        return sum(_count_markers(item) for item in value)
    return 0


TOOL_TURN: list[dict[str, Any]] = [
    {"role": "user", "content": "Lies Artefakt 01."},
    {
        "role": "assistant",
        "content": "Ich lese es.",
        "tool_calls": [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "read_artifact", "arguments": '{"slot": "01"}'},
            }
        ],
    },
    {"role": "tool", "tool_call_id": "call_1", "content": "status: draft"},
    {"role": "assistant", "content": "Der Entwurf ist kurz."},
]


# --- expand_history ---


def test_expand_history_turns_plain_rows_into_role_content_messages() -> None:
    rows = [
        HistoryRow(role="user", content="Hallo", transcript=[]),
        HistoryRow(role="assistant", content="Guten Tag", transcript=[]),
    ]
    assert expand_history(rows) == [
        {"role": "user", "content": "Hallo"},
        {"role": "assistant", "content": "Guten Tag"},
    ]


def test_expand_history_replays_the_transcript_of_an_assistant_row_unchanged() -> None:
    transcript = TOOL_TURN[1:]
    rows = [
        HistoryRow(role="user", content="Hallo", transcript=[]),
        HistoryRow(role="assistant", content="Der Entwurf ist kurz.", transcript=transcript),
        HistoryRow(role="user", content="Danke", transcript=[]),
    ]
    assert expand_history(rows) == [
        {"role": "user", "content": "Hallo"},
        *transcript,
        {"role": "user", "content": "Danke"},
    ]


def test_expand_history_of_nothing_is_empty() -> None:
    assert expand_history([]) == []


# --- documents_block ---


def test_documents_block_wraps_each_document_and_joins_with_blank_lines() -> None:
    block = documents_block([_document("brief.md", "Faster offers."), _document("b.txt", "More.")])
    assert block == (
        '<document name="brief.md">\nFaster offers.\n</document>\n\n'
        '<document name="b.txt">\nMore.\n</document>'
    )


def test_documents_block_skips_documents_without_text() -> None:
    block = documents_block(
        [_document("scan.pdf", None), _document("empty.md", ""), _document("brief.md", "Text.")]
    )
    assert block == '<document name="brief.md">\nText.\n</document>'


def test_documents_block_without_documents_is_empty() -> None:
    assert documents_block([]) == ""
    assert documents_block([_document("scan.pdf", None)]) == ""


# --- approved_block ---


def test_approved_block_keeps_every_slot_in_the_given_order() -> None:
    block = approved_block(
        [
            _approved("project_description", 2, "## Problem\nA.\n"),
            _approved("stakeholder_analysis", 1, "## Stakeholders\nB.\n", "draft"),
            _approved("open_issues", 3, "### Q\nC.\n"),
        ]
    )
    assert block == (
        '<approved slot="01" version="2" current_status="approved">\n## Problem\nA.\n\n</approved>'
        "\n\n"
        '<approved slot="02" version="1" current_status="draft">\n'
        "## Stakeholders\nB.\n\n</approved>"
        "\n\n"
        '<approved slot="03" version="3" current_status="approved">\n### Q\nC.\n\n</approved>'
    )


def test_approved_block_without_items_is_empty() -> None:
    assert approved_block([]) == ""


def test_approved_block_rejects_a_type_without_a_slot() -> None:
    with pytest.raises(ValueError, match="notes"):
        approved_block([_approved("notes", 1, "x")])


# --- turn_block ---


def test_turn_block_has_state_artifact_comments_chip_and_events_in_this_order() -> None:
    chip = _comment(
        2,
        "Vague scope",
        "Scope is unclear.",
        {"kind": "text_change", "find": "a", "replace": "ä"},
    )
    comments = [_comment(1, "No numbers", "Add numbers."), chip]
    block = turn_block(
        state="01 project_description: draft (open comments: 2)\nopen: 01\nrun: idle",
        open_artifact=_open_artifact(comments=comments),
        chip=chip,
        events=["Artifact 01 was edited by the user.", "Review 1 finished."],
    )
    assert block == (
        "<state>\n01 project_description: draft (open comments: 2)\nopen: 01\nrun: idle\n</state>"
        "\n\n"
        '<open_artifact slot="01" status="draft">\n## Problem\nOffers take long.\n\n</open_artifact>'
        "\n\n"
        "<open_comments>\n- #1 No numbers: Add numbers.\n- #2 Vague scope: Scope is unclear."
        "\n</open_comments>"
        "\n\n"
        '<chip id="c2">\nTitle: Vague scope\nDescription: Scope is unclear.\n'
        'Suggestion: {"kind": "text_change", "find": "a", "replace": "ä"}\n</chip>'
        "\n\n"
        "<events>\n- Artifact 01 was edited by the user.\n- Review 1 finished.\n</events>"
    )


def test_turn_block_omits_parts_without_data() -> None:
    assert (
        turn_block(state="open: none\nrun: idle", open_artifact=None, chip=None, events=[])
        == "<state>\nopen: none\nrun: idle\n</state>"
    )


def test_turn_block_omits_open_comments_when_the_open_artifact_has_none() -> None:
    block = turn_block(state="s", open_artifact=_open_artifact(), chip=None, events=[])
    assert "<open_artifact" in block
    assert "<open_comments>" not in block


def test_turn_block_chip_without_suggestion_has_no_suggestion_line() -> None:
    chip = _comment(1, "No numbers", "Add numbers.")
    block = turn_block(state="s", open_artifact=_open_artifact(), chip=chip, events=[])
    assert '<chip id="c1">\nTitle: No numbers\nDescription: Add numbers.\n</chip>' in block
    assert "Suggestion:" not in block


def test_turn_block_chip_suggestion_is_json_without_ascii_escaping() -> None:
    suggestion = {"kind": "workshop_question", "question": "Wer entscheidet über Budget?"}
    chip = _comment(1, "Budget", "Unclear.", suggestion)
    block = turn_block(state="s", open_artifact=None, chip=chip, events=[])
    assert f"Suggestion: {json.dumps(suggestion, ensure_ascii=False)}" in block
    assert "über" in block


def test_turn_block_points_to_the_approved_block_for_an_approved_open_artifact() -> None:
    block = turn_block(
        state="s",
        open_artifact=_open_artifact(status="approved", content="## Problem\nSecret text.\n"),
        chip=None,
        events=[],
    )
    assert (
        '<open_artifact slot="01" status="approved">\n'
        'Identical to the <approved slot="01"> block.\n</open_artifact>'
    ) in block
    assert "Secret text." not in block


# --- build_messages ---


def _build(**overrides: Any) -> list[dict[str, Any]]:
    arguments: dict[str, Any] = {
        "system_prompt": "You are the Analyst.",
        "documents": "<document>D</document>",
        "approved": "<approved>A</approved>",
        "history": [],
        "turn": "<state>S</state>",
        "user_message": "Hallo",
    }
    arguments.update(overrides)
    return build_messages(**arguments)


def test_build_messages_system_message_has_instructions_documents_and_approved_blocks() -> None:
    messages = _build()
    assert messages[0] == {
        "role": "system",
        "content": [
            {"type": "text", "text": "You are the Analyst."},
            {"type": "text", "text": "<document>D</document>", "cache_control": EPHEMERAL},
            {"type": "text", "text": "<approved>A</approved>", "cache_control": EPHEMERAL},
        ],
    }


def test_build_messages_omits_an_empty_documents_block() -> None:
    content = _build(documents="")[0]["content"]
    assert [block["text"] for block in content] == [
        "You are the Analyst.",
        "<approved>A</approved>",
    ]
    assert content[1]["cache_control"] == EPHEMERAL


def test_build_messages_omits_an_empty_approved_block() -> None:
    content = _build(approved="")[0]["content"]
    assert [block["text"] for block in content] == [
        "You are the Analyst.",
        "<document>D</document>",
    ]


def test_build_messages_system_message_is_only_the_instructions_without_sources() -> None:
    assert _build(documents="", approved="")[0] == {
        "role": "system",
        "content": [{"type": "text", "text": "You are the Analyst."}],
    }


def test_build_messages_last_message_wraps_turn_and_user_text() -> None:
    assert _build()[-1] == {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": "<state>S</state>\n\n<user_message>\nHallo\n</user_message>",
                "cache_control": EPHEMERAL,
            }
        ],
    }


def test_build_messages_without_history_is_system_then_user() -> None:
    assert [m["role"] for m in _build()] == ["system", "user"]


def test_build_messages_marks_the_last_text_message_of_the_history() -> None:
    history = [
        {"role": "user", "content": "Hallo"},
        {"role": "assistant", "content": "Guten Tag"},
    ]
    messages = _build(history=history)
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
    assert messages[1] == {"role": "user", "content": "Hallo"}
    assert messages[2] == {
        "role": "assistant",
        "content": [{"type": "text", "text": "Guten Tag", "cache_control": EPHEMERAL}],
    }


def test_build_messages_marks_the_last_text_message_when_history_ends_with_a_tool_message() -> None:
    history = [*TOOL_TURN[:3]]
    messages = _build(history=history)
    assert messages[1] == TOOL_TURN[0]
    assert messages[2]["content"] == [
        {"type": "text", "text": "Ich lese es.", "cache_control": EPHEMERAL}
    ]
    assert messages[2]["tool_calls"] == TOOL_TURN[1]["tool_calls"]
    assert messages[3] == TOOL_TURN[2]


def test_build_messages_skips_assistant_messages_without_text_when_placing_the_marker() -> None:
    history = [
        {"role": "user", "content": "Hallo"},
        {"role": "assistant", "content": "", "tool_calls": []},
        {"role": "assistant", "content": None, "tool_calls": TOOL_TURN[1]["tool_calls"]},
        {"role": "tool", "tool_call_id": "call_1", "content": "ok"},
    ]
    messages = _build(history=history)
    assert messages[1]["content"] == [{"type": "text", "text": "Hallo", "cache_control": EPHEMERAL}]
    assert messages[2] == history[1]
    assert messages[3] == history[2]
    assert messages[4] == history[3]


def test_build_messages_places_no_history_marker_when_no_message_has_text() -> None:
    history = [{"role": "tool", "tool_call_id": "call_1", "content": "ok"}]
    messages = _build(history=history)
    assert messages[1] == history[0]
    assert _count_markers(messages) == 3


def test_build_messages_has_at_most_four_cache_markers() -> None:
    history = [
        *TOOL_TURN,
        {"role": "user", "content": "Und jetzt?"},
        {"role": "assistant", "content": "Weiter."},
    ]
    assert _count_markers(_build(history=history)) == 4
    assert _count_markers(_build(history=history, documents="", approved="")) == 2
    assert _count_markers(_build(history=[], documents="", approved="")) == 1


def test_build_messages_leaves_the_input_history_unchanged() -> None:
    history = [*copy.deepcopy(TOOL_TURN), {"role": "assistant", "content": "Weiter."}]
    snapshot = copy.deepcopy(history)
    messages = _build(history=history)
    assert history == snapshot
    assert messages[-2]["content"][0]["cache_control"] == EPHEMERAL
    assert history[-1]["content"] == "Weiter."


def test_turn_block_shows_an_open_free_artifact_with_id_and_title() -> None:
    free = OpenArtifact(
        id="f1", slot=None, status="draft", content="# Agenda\n", open_comments=[], title="Agenda"
    )

    block = turn_block(state="s", open_artifact=free, chip=None, events=[])

    assert (
        '<open_artifact id="f1" title="Agenda" status="free-form">\n# Agenda\n\n</open_artifact>'
        in block
    )
