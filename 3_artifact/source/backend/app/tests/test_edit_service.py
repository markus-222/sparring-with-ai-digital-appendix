"""apply_edit: the single deterministic edit path."""

from app.services.edit_service import apply_edit, count_matches, replace_section


def test_single_match_is_replaced_and_range_points_at_new_text() -> None:
    result = apply_edit("a b c", find="b", replace="XX")
    assert result.status == "applied"
    assert result.content == "a XX c"
    assert result.content[result.start : result.end] == "XX"


def test_no_match_leaves_content_unchanged() -> None:
    result = apply_edit("a b c", find="z", replace="XX")
    assert result.status == "not_found"
    assert result.content == "a b c"
    assert result.start is None and result.end is None


def test_several_matches_leave_content_unchanged() -> None:
    result = apply_edit("x y x", find="x", replace="Z")
    assert result.status == "ambiguous"
    assert result.content == "x y x"


def test_overlapping_matches_count_as_ambiguous() -> None:
    assert apply_edit("aaa", find="aa", replace="b").status == "ambiguous"


def test_empty_find_is_not_found() -> None:
    assert apply_edit("abc", find="", replace="x").status == "not_found"


def test_insertion_keeps_anchor_text() -> None:
    result = apply_edit("## A\n- x", find="- x", replace="- x\n- y")
    assert result.status == "applied"
    assert result.content == "## A\n- x\n- y"


def test_curly_quotes_in_document_match_straight_quotes_in_find() -> None:
    result = apply_edit("He said “hi” now", find='"hi"', replace='"yo"')
    assert result.status == "applied"
    assert result.content == 'He said "yo" now'


def test_curly_apostrophe_matches_straight_apostrophe() -> None:
    result = apply_edit("it’s fine", find="it's", replace="it is")
    assert result.content == "it is fine"


def test_runs_of_spaces_tabs_and_nbsp_are_collapsed() -> None:
    assert apply_edit("a  b c", find="a b c", replace="X").content == "X"
    assert apply_edit("a\t\tb", find="a b", replace="X").content == "X"
    assert apply_edit("a  b", find="a b", replace="X").content == "X"


def test_crlf_document_matches_lf_find() -> None:
    assert apply_edit("a\r\nb", find="a\nb", replace="X").content == "X"


def test_range_refers_to_the_original_span_when_whitespace_was_normalized() -> None:
    result = apply_edit("a  b c", find="a b", replace="X")
    assert result.content == "X c"
    assert (result.start, result.end) == (0, 1)


def test_count_matches_uses_the_same_normalization() -> None:
    assert count_matches("a  a", "a") == 2
    assert count_matches("it’s", "it's") == 1
    assert count_matches("abc", "") == 0


SECTIONS = "# Doc\n\nIntro.\n\n## A\n\nText a.\n\n### A1\n\nDeep.\n\n## B\n\nText b.\n"


def test_replace_section_swaps_heading_body_and_subsections() -> None:
    result = replace_section(SECTIONS, "A", "## A\n\nShort.\n")
    assert result.status == "applied"
    assert result.content == "# Doc\n\nIntro.\n\n## A\n\nShort.\n\n## B\n\nText b.\n"
    assert result.start is not None and result.end is not None
    assert result.content[result.start : result.end] == "## A\n\nShort.\n\n"


def test_replace_section_accepts_the_heading_with_its_marker() -> None:
    result = replace_section(SECTIONS, "### A1 ", "### A1\n\nNew.")
    assert (
        result.content
        == "# Doc\n\nIntro.\n\n## A\n\nText a.\n\n### A1\n\nNew.\n\n## B\n\nText b.\n"
    )


def test_replace_section_at_the_end_keeps_one_trailing_newline() -> None:
    result = replace_section(SECTIONS, "B", "## B\n\nNew b.\n\n")
    assert (
        result.content
        == "# Doc\n\nIntro.\n\n## A\n\nText a.\n\n### A1\n\nDeep.\n\n## B\n\nNew b.\n"
    )


def test_replace_section_with_empty_text_deletes_the_section() -> None:
    result = replace_section(SECTIONS, "A", "")
    assert result.content == "# Doc\n\nIntro.\n\n## B\n\nText b.\n"
    assert result.start == result.end


def test_replace_section_of_the_top_heading_replaces_everything() -> None:
    result = replace_section(SECTIONS, "Doc", "# Doc\n\nAll new.\n")
    assert result.content == "# Doc\n\nAll new.\n"


def test_replace_section_reports_a_missing_heading() -> None:
    for heading in ("C", "", "#"):
        result = replace_section(SECTIONS, heading, "x")
        assert result.status == "not_found"
        assert result.content == SECTIONS


def test_replace_section_reports_a_repeated_heading() -> None:
    content = "## A\n\none\n\n## A\n\ntwo\n"
    result = replace_section(content, "A", "x")
    assert result.status == "ambiguous"
    assert result.content == content


def test_replace_section_ignores_headings_inside_code_fences() -> None:
    content = "## A\n\n```\n## B\n```\n\ntail\n\n## C\n\nc\n"
    assert replace_section(content, "B", "x").status == "not_found"
    assert replace_section(content, "A", "## A\n\nnew").content == "## A\n\nnew\n\n## C\n\nc\n"
