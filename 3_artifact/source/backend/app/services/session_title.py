"""Deterministic chat titles: the first user message, shortened."""

TITLE_MAX_LENGTH = 60


def derive_title(message: str) -> str | None:
    """Collapse whitespace and cut at a word boundary; None for a blank message."""
    text = " ".join(message.split())
    if not text:
        return None
    if len(text) <= TITLE_MAX_LENGTH:
        return text
    cut = text[: TITLE_MAX_LENGTH - 1]
    head, _, _ = cut.rpartition(" ")
    return f"{head or cut}…"
