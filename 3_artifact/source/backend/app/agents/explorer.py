"""Explorer: other perspectives on the open draft; comments only, no tools."""

from app.agents.base import load_prompt
from app.agents.commenting import CommentingAgent


class ExplorerAgent(CommentingAgent):
    name = "explorer"
    role = "explorer"
    max_comments = 2
    later_review_max_comments = 1
    system_prompt = load_prompt("explorer")

    def comment_limit(self, resolved_findings: str) -> int:
        # Resolved findings only exist from the second review on (a review needs all comments resolved).
        return self.later_review_max_comments if resolved_findings else self.max_comments
