"""Reviewer: critical review of the open draft (errors, contradictions, sources, depth)."""

from app.agents.base import load_prompt
from app.agents.commenting import CommentingAgent


class ReviewerAgent(CommentingAgent):
    name = "reviewer"
    role = "reviewer"
    max_comments = 5
    system_prompt = load_prompt("reviewer")
