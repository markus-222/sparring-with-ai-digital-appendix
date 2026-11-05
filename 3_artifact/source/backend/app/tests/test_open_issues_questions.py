"""insert_question: where the item lands in artifact 03."""

from app.services.open_issues_questions import insert_question, insert_questions


def _span(content: str, start: int, end: int) -> str:
    return content[start:end]


def test_into_empty_content_creates_just_the_item() -> None:
    content, start, end = insert_question("", "Budget", "Who pays?")

    assert content == "### Budget\n\n**Question:** Who pays?\n"
    assert _span(content, start, end) == "### Budget\n\n**Question:** Who pays?"


def test_after_existing_topics_the_item_is_appended_at_the_end() -> None:
    content, start, end = insert_question(
        "## A\n\n### X\n**Question:** x?\n", "Budget", "Who pays?"
    )

    assert content == "## A\n\n### X\n**Question:** x?\n\n### Budget\n\n**Question:** Who pays?\n"
    assert _span(content, start, end) == "### Budget\n\n**Question:** Who pays?"


def test_a_second_question_follows_the_first() -> None:
    first, _, _ = insert_question("", "A", "a?")

    content, start, end = insert_question(first, "B", "b?")

    assert content == "### A\n\n**Question:** a?\n\n### B\n\n**Question:** b?\n"
    assert _span(content, start, end) == "### B\n\n**Question:** b?"


def test_the_result_passes_the_format_check_item_lines() -> None:
    from app.services.format_check import check_format

    content, _, _ = insert_question("", "Budget", "Who pays?")

    report = check_format("03", content, known_documents=[])

    assert [f.code for f in report.findings if f.code != "vague_term"] == []


def test_several_questions_are_appended_in_order_and_the_span_covers_all() -> None:
    content, start, end = insert_questions("## A\n\n### X\nx\n", [("B", "b?"), ("C", "c?")])

    assert content == "## A\n\n### X\nx\n\n### B\n\n**Question:** b?\n\n### C\n\n**Question:** c?\n"
    assert _span(content, start, end) == "### B\n\n**Question:** b?\n\n### C\n\n**Question:** c?"


def test_the_item_lands_before_the_closing_sections() -> None:
    closing = "## 4. Vorab anzufordernde Dokumente & Daten\n- x\n\n## 5. Working Assumptions\n- y\n"
    before = "## 3. Block C: Technische & prozessuale Constraints\n\n### X\n\n**Question:** x?\n\n"

    content, start, end = insert_question(before + closing, "B", "b?")

    assert content == f"{before}### B\n\n**Question:** b?\n\n{closing}"
    assert content[start:end] == "### B\n\n**Question:** b?"


def test_the_closing_sections_are_found_in_any_language() -> None:
    closing = "## 4. Documents & Data to Request in Advance\n- x\n"
    before = "## 3. Block C: Technical & Process Constraints\n\n### X\n\n**Question:** x?\n\n"

    content, _, _ = insert_question(before + closing, "B", "b?")

    assert content == f"{before}### B\n\n**Question:** b?\n\n{closing}"
