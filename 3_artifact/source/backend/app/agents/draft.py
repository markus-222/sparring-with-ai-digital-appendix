"""Draft Analyst: writes one artifact draft from the run inputs."""

import logging
import re

from app.agents.base import BaseAgent, load_prompt
from app.schemas.run import Slot

logger = logging.getLogger(__name__)

_FENCE = re.compile(r"^```(?:markdown|md)?[ \t]*\n(.*?)\n```[ \t]*$", re.DOTALL)

_STRUCTURES: dict[Slot, str] = {
    "01": load_prompt("structures/01"),
    "02": load_prompt("structures/02"),
    "03": load_prompt("structures/03"),
}

_FULL_TASK = (
    "Write the draft of the target artifact now. Reply with the Markdown of the artifact only."
)
_MERGE_TASK = (
    "The target artifact already has content, given in <existing_draft>. Write the complete "
    "artifact again and merge into it: keep every point of <existing_draft> (also those without "
    "a source, they come from the user), add what the inputs contain beyond it, and state each "
    "point once. Reply with the Markdown of the complete artifact only."
)


class EmptyDraftError(Exception):
    """The model answered with no draft text."""


class DraftTruncatedError(Exception):
    """The answer hit max_tokens (thinking counts against it): a cut-off draft is never saved."""


def _clean(raw: str | None) -> str:
    text = (raw or "").strip()
    match = _FENCE.match(text)
    return (match.group(1) if match else text).strip()


def _structure(slot: Slot) -> str:
    return f"<structure>\n{_STRUCTURES[slot]}\n</structure>"


def _language(language: str | None) -> str:
    return f"<language>{language}</language>\n\n" if language else ""


# Retry after a cut-off answer: more room, less thinking. The ceiling is the call timeout
# (LLM_TIMEOUT_SECONDS, ~190 tokens/s measured) and the whole run budget (RUN_TIMEOUT_SECONDS).
_RETRY_MAX_TOKENS = 20000
_RETRY_EFFORT = "low"


class DraftAgent(BaseAgent):
    name = "analyst_draft"
    system_prompt = load_prompt("analyst_draft")
    # Thinking counts against max_tokens. Measured on a 21k-char input: default effort used
    # ~28k tokens / 160s (over the call timeout), medium ~10k tokens / 50s.
    max_tokens = 16000
    reasoning_effort = "medium"

    async def write(
        self, *, inputs: str, slot: Slot, merge: bool = False, language: str | None = None
    ) -> str:
        task = _MERGE_TASK if merge else _FULL_TASK
        prompt = f"{inputs}\n\n{_structure(slot)}\n\n{_language(language)}{task}"
        messages = self._build_messages(prompt, None)
        response = await self._call_llm(messages)
        if response["finish_reason"] == "length":
            logger.warning(f"[{self.name}] draft hit max_tokens, retrying with a larger budget")
            response = await self._call_llm(
                messages, max_tokens=_RETRY_MAX_TOKENS, reasoning_effort=_RETRY_EFFORT
            )
            if response["finish_reason"] == "length":
                raise DraftTruncatedError
        draft = _clean(response["content"])
        if not draft:
            raise EmptyDraftError
        return draft

    async def fix_format(
        self, *, inputs: str, slot: Slot, draft: str, report: str, language: str | None = None
    ) -> str:
        prompt = (
            f"{inputs}\n\n{_structure(slot)}\n\n{_language(language)}"
            f"<current_draft>\n{draft}\n</current_draft>\n\n"
            f"<format_report>\n{report}\n</format_report>\n\n"
            "Correct only the format problems listed in the format report; keep everything else "
            "as it is, including all markers. A vague term you phrased yourself: rephrase it "
            "neutrally or delete it, never invent a value. Reply with the complete corrected "
            "Markdown of the artifact only."
        )
        response = await self._call_llm(self._build_messages(prompt, None))
        if response["finish_reason"] == "length":
            return draft  # a cut-off correction must never replace the complete draft
        return _clean(response["content"]) or draft
