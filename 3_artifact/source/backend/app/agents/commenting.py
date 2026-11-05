"""Shared base for the comment-producing roles (Reviewer, Explorer)."""

import json
import logging
from collections.abc import Callable
from typing import Any, Literal

from pydantic import ValidationError

from app.agents.base import BaseAgent
from app.infra.llm import LLMClient
from app.schemas.review import ProposedComment, ProposedCommentsSubmission

logger = logging.getLogger(__name__)

SUBMIT_PROPOSALS_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "submit_comments",
        "description": "Submit your comments on the draft (an empty list if there is nothing to raise).",
        "parameters": ProposedCommentsSubmission.model_json_schema(),
    },
}

CommentCheck = Callable[[ProposedComment], str | None]
# `check` problems drop the comment; `advisory_check` problems only trigger the correction round.


def _correction_message(raw: str, errors: list[str]) -> str:
    problems = "\n".join(f"- {error}" for error in errors)
    return (
        "Your submission had problems:\n"
        f"{problems}\n\n"
        f"Your previous arguments were:\n{raw}\n\n"
        "Call submit_comments again with the complete corrected list. "
        "Use only block ids that appear in <draft_numbered>."
    )


def _missing_call_messages(text: str | None) -> list[dict[str, Any]]:
    reminder = {
        "role": "user",
        "content": "Call submit_comments now (an empty list if there is nothing to raise).",
    }
    return [{"role": "assistant", "content": text}, reminder] if text else [reminder]


class CommentingAgent(BaseAgent):
    role: Literal["reviewer", "explorer"]
    max_comments: int
    max_tokens = 8192

    def __init__(self, llm: LLMClient, model: str | None = None) -> None:
        super().__init__(llm, model)

    def comment_limit(self, resolved_findings: str) -> int:
        return self.max_comments

    def _prompt(
        self,
        numbered_draft: str,
        context: str,
        resolved_findings: str,
        format_report: str,
        limit: int,
    ) -> str:
        parts = [context, f"<draft_numbered>\n{numbered_draft}\n</draft_numbered>"]
        if format_report:
            parts.append(f"<format_report>\n{format_report}\n</format_report>")
        if resolved_findings:
            parts.append(f"<already_resolved>\n{resolved_findings}\n</already_resolved>")
        parts.append(f"Review the draft. Submit at most {limit} comments via submit_comments.")
        return "\n\n".join(part for part in parts if part)

    def _parse(
        self, raw: str, check: CommentCheck | None, advisory_check: CommentCheck | None, limit: int
    ) -> tuple[list[ProposedComment], list[str], list[str]]:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return [], ["the arguments were not valid JSON"], []
        items = payload.get("comments") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            return [], ['the arguments must be an object with a "comments" list'], []
        valid: list[ProposedComment] = []
        errors: list[str] = []
        advice_list: list[str] = []
        for position, item in enumerate(items, start=1):
            if len(valid) >= limit:
                break
            if not isinstance(item, dict):
                errors.append(f"comment {position}: must be an object")
                continue
            data = {**item, "role": self.role}
            if self.role == "reviewer":
                data["hypothesis"] = False
            label = f"comment {position} ({item.get('title', '?')})"
            try:
                proposed = ProposedComment.model_validate(data)
            except ValidationError as exc:
                errors.append(f"{label}: {exc.errors()[0]['msg']}")
                continue
            problem = check(proposed) if check else None
            if problem:
                errors.append(f"{label}: {problem}")
                continue
            valid.append(proposed)
            advice = advisory_check(proposed) if advisory_check else None
            if advice:
                advice_list.append(f"{label}: {advice}")
        return valid, errors, advice_list

    async def propose(
        self,
        *,
        numbered_draft: str,
        context: str,
        resolved_findings: str = "",
        format_report: str = "",
        check: CommentCheck | None = None,
        advisory_check: CommentCheck | None = None,
    ) -> list[ProposedComment]:
        limit = self.comment_limit(resolved_findings)
        prompt = self._prompt(numbered_draft, context, resolved_findings, format_report, limit)
        messages = self._build_messages(prompt, None)
        kept: list[ProposedComment] = []
        errors: list[str] = []
        advice: list[str] = []
        for _attempt in range(2):
            response = await self._call_llm(
                messages,
                tools=[SUBMIT_PROPOSALS_TOOL],
                # Sonnet 5.5 and Opus 5.5 reject a forced tool_choice; a missing call is asked for once.
                tool_choice="auto",
            )
            calls = response.get("tool_calls") or []
            if not calls:
                if _attempt > 0 or kept:
                    return kept
                messages = [*messages, *_missing_call_messages(response.get("content"))]
                continue
            raw = calls[0]["function"]["arguments"]
            kept, errors, advice = self._parse(raw, check, advisory_check, limit)
            if not errors and not advice:
                return kept
            correction = _correction_message(raw, [*errors, *advice])
            messages = [*messages, {"role": "user", "content": correction}]
        for error in errors:
            logger.warning(f"[{self.name}] dropped invalid comment: {error}")
        for hint in advice:
            logger.warning(f"[{self.name}] kept comment with unresolved hint: {hint}")
        return kept
