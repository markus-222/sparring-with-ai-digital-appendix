"""Question proposal card of an assistant message (messages.proposal JSON)."""

from typing import Any, Literal

from pydantic import BaseModel, Field

ProposalState = Literal["open", "accepted", "rejected"]


class ProposedQuestion(BaseModel):
    id: str
    title: str
    text: str
    state: ProposalState = "open"


class QuestionProposal(BaseModel):
    id: str
    status: ProposalState = "open"
    questions: list[ProposedQuestion] = Field(min_length=1)
    origin_artifact_id: str | None = None

    def settled(self, accepted_ids: set[str]) -> "QuestionProposal":
        """Resolve the card: the chosen questions are accepted, all others rejected."""
        questions = [
            q.model_copy(update={"state": "accepted" if q.id in accepted_ids else "rejected"})
            for q in self.questions
        ]
        status: ProposalState = "accepted" if accepted_ids else "rejected"
        return self.model_copy(update={"status": status, "questions": questions})


class ResolveProposalRequest(BaseModel):
    action: Literal["accept", "reject"]
    question_ids: list[str] = Field(default_factory=list)
    revoke: bool = False
    editor_open: bool = False


def proposal_column(proposal: QuestionProposal | None) -> dict[str, Any] | None:
    return None if proposal is None else proposal.model_dump(mode="json")


def read_proposal(stored: dict[str, Any] | None) -> QuestionProposal | None:
    return None if stored is None else QuestionProposal.model_validate(stored)
