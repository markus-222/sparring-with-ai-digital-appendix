"""Block numbering and block-edit resolution (review suggestions without quoted text)."""

import pytest

from app.schemas.review import (
    BlockEditProposal,
    ProposedComment,
    TextChangeSuggestion,
    WorkshopQuestionSuggestion,
)
from app.services.blocks import (
    BlockResolutionError,
    render_numbered,
    resolve_block_edit,
    resolve_proposed_comment,
    split_blocks,
)
from app.services.edit_service import apply_edit, count_matches

DOC = (
    "# T\n\n## Problem\n- Courses are old [[doc:a.md]]\n- Influence: high\n\n"
    "## Other\nText line one\ncontinued\n\n### DPO\n- Influence: high\n"
)


def test_split_blocks_classifies_and_keeps_verbatim_text() -> None:
    blocks = split_blocks(DOC)
    assert [b.kind for b in blocks] == [
        "heading",
        "heading",
        "list_item",
        "list_item",
        "heading",
        "paragraph",
        "heading",
        "list_item",
    ]
    assert [b.id for b in blocks] == [f"B{i}" for i in range(1, 9)]
    assert all(DOC[b.start : b.end] == b.text for b in blocks)
    assert blocks[5].text == "Text line one\ncontinued"


def test_render_numbered_prefixes_each_block_with_its_id() -> None:
    rendered = render_numbered(split_blocks("## A\n- x"))
    assert rendered == "[B1] ## A\n[B2] - x"


def test_replace_resolves_to_find_replace_with_exactly_one_match() -> None:
    find, replace = resolve_block_edit(DOC, "B3", "replace", "- Courses are outdated [[doc:a.md]]")
    assert find == "- Courses are old [[doc:a.md]]"
    result = apply_edit(DOC, find, replace)
    assert result.status == "applied"
    assert result.content.count("outdated") == 1


def test_duplicate_block_text_is_extended_with_preceding_blocks() -> None:
    find, replace = resolve_block_edit(DOC, "B8", "replace", "- Influence: very high")
    assert count_matches(DOC, find) == 1
    assert find.startswith("### DPO")
    content = apply_edit(DOC, find, replace).content
    assert content.endswith("### DPO\n- Influence: very high\n")
    assert content.count("- Influence: high") == 1


def test_insert_after_list_item_uses_single_newline() -> None:
    find, replace = resolve_block_edit(DOC, "B3", "insert_after", "- New point")
    lines = apply_edit(DOC, find, replace).content.splitlines()
    assert lines[3:5] == ["- Courses are old [[doc:a.md]]", "- New point"]


def test_insert_after_heading_uses_blank_line() -> None:
    find, replace = resolve_block_edit(DOC, "B2", "insert_after", "Intro paragraph")
    assert "## Problem\n\nIntro paragraph\n- Courses" in apply_edit(DOC, find, replace).content


def test_unknown_block_id_is_rejected_immediately() -> None:
    with pytest.raises(BlockResolutionError):
        resolve_block_edit(DOC, "B99", "replace", "x")


def test_user_edit_after_review_makes_the_stored_suggestion_not_found() -> None:
    find, replace = resolve_block_edit(DOC, "B3", "replace", "x")
    edited = DOC.replace("old", "ancient")
    assert apply_edit(edited, find, replace).status == "not_found"


def test_block_edit_proposal_requires_block_id_format() -> None:
    with pytest.raises(ValueError):
        BlockEditProposal(block_id="3", mode="replace", text="x")


def test_proposed_comment_with_block_edit_becomes_text_change() -> None:
    proposed = ProposedComment(
        role="reviewer",
        title="Outdated",
        explanation="e",
        suggestion=BlockEditProposal(block_id="B3", mode="replace", text="- New"),
    )
    comment = resolve_proposed_comment(proposed, DOC)
    assert isinstance(comment.suggestion, TextChangeSuggestion)
    assert comment.suggestion.find == "- Courses are old [[doc:a.md]]"


def test_proposed_workshop_question_passes_through() -> None:
    proposed = ProposedComment(
        role="explorer",
        hypothesis=True,
        title="t",
        explanation="e",
        suggestion=WorkshopQuestionSuggestion(text="Who owns the data?"),
    )
    comment = resolve_proposed_comment(proposed, DOC)
    assert comment.suggestion == WorkshopQuestionSuggestion(text="Who owns the data?")


def test_hypothesis_cannot_carry_block_edit() -> None:
    with pytest.raises(ValueError):
        ProposedComment(
            role="explorer",
            hypothesis=True,
            title="t",
            explanation="e",
            suggestion=BlockEditProposal(block_id="B1", mode="replace", text="x"),
        )
