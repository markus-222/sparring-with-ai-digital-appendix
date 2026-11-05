"""Unit tests for the comment/review response and request schemas."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.comment import Comment
from app.schemas.review import CommentEdit, CommentResponse


def _row(**extra: object) -> dict[str, object]:
    return {
        "id": "c1",
        "artifact_id": "a1",
        "number": 1,
        "review_number": 1,
        "title": "T",
        "description": "D",
        "role": "reviewer",
        "hypothesis": False,
        "sources": [],
        "suggestion": {"kind": "text_change", "find": "a", "replace": "b"},
        "status": "open",
        "created_at": "2026-10-04T10:00:00Z",
        **extra,
    }


def test_comment_response_parses_the_stored_suggestion_by_kind() -> None:
    response = CommentResponse.model_validate(_row())

    assert response.suggestion is not None and response.suggestion.kind == "text_change"


def test_comment_response_rejects_an_unknown_suggestion_kind() -> None:
    with pytest.raises(ValidationError):
        CommentResponse.model_validate(_row(suggestion={"kind": "bogus"}))


def test_comment_response_allows_a_comment_without_suggestion() -> None:
    assert CommentResponse.model_validate(_row(suggestion=None)).suggestion is None


def test_comment_edit_requires_a_non_empty_text() -> None:
    with pytest.raises(ValidationError):
        CommentEdit.model_validate({"suggestion": {"kind": "workshop_question", "text": ""}})


def test_comment_response_from_attributes_round_trip() -> None:
    comment = Comment(
        id="comment-1",
        artifact_id="art-1",
        number=2,
        review_number=1,
        title="No mitigation strategy",
        description="The risk has no mitigation strategy.",
        sources=[],
        status="open",
        role="explorer",
        hypothesis=True,
        suggestion={"kind": "workshop_question", "text": "Who owns the risk?"},
        created_at=datetime.now(UTC),
    )

    response = CommentResponse.model_validate(comment)

    assert response.id == "comment-1"
    assert response.number == 2
    assert response.role == "explorer"
    assert response.hypothesis is True
    assert response.suggestion is not None and response.suggestion.kind == "workshop_question"
