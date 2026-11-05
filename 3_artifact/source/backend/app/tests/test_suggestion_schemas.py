import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.review import (
    ReviewComment,
    Suggestion,
    TextChangeSuggestion,
    WorkshopQuestionSuggestion,
)


def test_suggestion_union_dispatches_on_kind() -> None:
    adapter: TypeAdapter[TextChangeSuggestion | WorkshopQuestionSuggestion] = TypeAdapter(
        Suggestion
    )
    assert isinstance(
        adapter.validate_python({"kind": "text_change", "find": "a", "replace": "b"}),
        TextChangeSuggestion,
    )
    assert isinstance(
        adapter.validate_python({"kind": "workshop_question", "text": "Why?"}),
        WorkshopQuestionSuggestion,
    )


def test_text_change_requires_non_empty_find() -> None:
    with pytest.raises(ValidationError):
        TextChangeSuggestion(find="", replace="x")


def test_hypothesis_comment_cannot_carry_text_change() -> None:
    with pytest.raises(ValidationError):
        ReviewComment(
            role="explorer",
            hypothesis=True,
            title="t",
            explanation="e",
            suggestion=TextChangeSuggestion(find="a", replace="b"),
        )


def test_hypothesis_comment_with_question_is_valid() -> None:
    c = ReviewComment(
        role="explorer",
        hypothesis=True,
        title="t",
        explanation="e",
        suggestion=WorkshopQuestionSuggestion(text="Who owns data?"),
    )
    assert c.sources == []
