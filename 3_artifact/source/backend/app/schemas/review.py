"""Shared schemas for review comments on an artifact."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TextChangeSuggestion(BaseModel):
    kind: Literal["text_change"] = "text_change"
    find: str = Field(min_length=1)
    replace: str


class WorkshopQuestionSuggestion(BaseModel):
    kind: Literal["workshop_question"] = "workshop_question"
    text: str = Field(min_length=1)


class BlockEditProposal(BaseModel):
    kind: Literal["block_edit"] = "block_edit"
    block_id: str = Field(pattern=r"^B\d+$")
    mode: Literal["replace", "insert_after"]
    text: str = Field(min_length=1)


Suggestion = Annotated[
    TextChangeSuggestion | WorkshopQuestionSuggestion, Field(discriminator="kind")
]
ProposedSuggestion = Annotated[
    BlockEditProposal | WorkshopQuestionSuggestion, Field(discriminator="kind")
]


class CommentResponse(BaseModel):
    id: str
    artifact_id: str
    number: int
    review_number: int
    title: str
    description: str
    role: Literal["reviewer", "explorer"]
    hypothesis: bool
    sources: list[str]
    suggestion: Suggestion | None
    status: Literal["open", "accepted", "edited", "rejected", "done_manually"]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CommentEdit(BaseModel):
    suggestion: Suggestion


class CommentActionResponse(BaseModel):
    outcome: Literal["applied", "question_added", "not_located", "rejected", "done_manually"]
    comment: CommentResponse


class ReviewComment(BaseModel):
    role: Literal["reviewer", "explorer"]
    hypothesis: bool = False
    title: str
    explanation: str
    sources: list[str] = []
    suggestion: Suggestion

    @model_validator(mode="after")
    def _hypothesis_only_questions(self) -> "ReviewComment":
        if self.hypothesis and not isinstance(self.suggestion, WorkshopQuestionSuggestion):
            raise ValueError("hypothesis comments may only suggest workshop questions")
        return self


class ProposedComment(BaseModel):
    role: Literal["reviewer", "explorer"]
    hypothesis: bool = False
    title: str
    explanation: str
    sources: list[str] = []
    suggestion: ProposedSuggestion

    @model_validator(mode="after")
    def _hypothesis_only_questions(self) -> "ProposedComment":
        if self.hypothesis and not isinstance(self.suggestion, WorkshopQuestionSuggestion):
            raise ValueError("hypothesis comments may only suggest workshop questions")
        return self


class CommentCandidate(BaseModel):
    topic: str
    severity: Literal["error", "gap", "minor"]
    reason: str


class ProposedCommentsSubmission(BaseModel):
    """Shape of the forced `submit_comments` tool call; only used to build its JSON schema.

    `candidates` comes first on purpose: the model fills fields in schema order, so it
    weighs the points there before it writes `comments`. It is never read or stored.
    """

    candidates: list[CommentCandidate]
    comments: list[ProposedComment]
