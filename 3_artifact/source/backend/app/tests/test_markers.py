from app.services.markers import extract_markers


def test_extracts_conflict_and_unclear_lines() -> None:
    content = (
        "## Problem\n"
        "- ⚠ CONFLICT: Number of users: 200 [[doc:a.md]] vs. 2,000 [[doc:b.md]]\n"
        "plain line\n"
        '  ? UNCLEAR: offers take "far too long" [[doc:c.md]]\n'
    )

    assert extract_markers(content) == [
        "- ⚠ CONFLICT: Number of users: 200 [[doc:a.md]] vs. 2,000 [[doc:b.md]]",
        '? UNCLEAR: offers take "far too long" [[doc:c.md]]',
    ]


def test_no_markers_gives_empty_list() -> None:
    assert extract_markers("## Problem\nNothing.") == []
