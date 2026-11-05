"""Format check: required headings, sources, vague terms. No AI, no DB."""

from app.services.format_check import FormatReport, check_format, render_report

VALID_01 = """# Project Description

## 1. Executive Summary
Offers take too long [[doc:interview.md]].

## 2. Kontext & Stakeholder
- Sales [[doc:kickoff.md]]

## 3. Problem Space
- Manual pricing [[doc:interview.md]]

## 4. Ziele & Erfolgskriterien
Lost deals [[doc:kickoff.md]]

## 5. Scope Definition
Offer creation

## 6. Project Requirements & Constraints
- Budget [[doc:kickoff.md]]
"""

_REST_02 = """## 2. Lücken in der Beteiligung (Blind Spots)
- Sales lead not interviewed [[doc:kickoff.md]]

## 3. Stakeholder Needs & Concerns
- Dispatcher [[doc:kickoff.md]]

## 4. Potenzielle Konflikte & Spannungsfelder
- none [[doc:kickoff.md]]

## 5. Potenziell negativ betroffene Stakeholder
- none [[doc:kickoff.md]]

## 6. Unsicherheiten & Annahmen
- none [[doc:kickoff.md]]
"""

VALID_02 = f"""## 1. Stakeholder Identification & Classification

### Dispatcher
- Roles: plans the tours
- Influence: medium

{_REST_02}"""

VALID_03 = """## Open Issues

### Response time target
**Question:** What response time is acceptable?
"""

DOCS = {"interview.md", "kickoff.md"}


def _codes(report: FormatReport) -> list[str]:
    return [f.code for f in report.findings]


def test_valid_slot_contents_pass() -> None:
    assert check_format("01", VALID_01, known_documents=DOCS).ok
    assert check_format("02", VALID_02, known_documents=DOCS).ok
    assert check_format("03", VALID_03, known_documents=set()).ok


def test_empty_content_is_one_finding() -> None:
    report = check_format("01", "  \n", known_documents=DOCS)

    assert _codes(report) == ["empty"]


def test_missing_heading_is_reported_with_the_heading() -> None:
    content = VALID_01.replace("## 3. Problem Space\n", "")

    report = check_format("01", content, known_documents=DOCS)

    assert [(f.code, f.detail) for f in report.findings] == [
        ("missing_heading", "## 3. Problem Space")
    ]


def test_missing_sources_when_required() -> None:
    content = VALID_01.replace(" [[doc:interview.md]]", "").replace(" [[doc:kickoff.md]]", "")

    report = check_format("01", content, known_documents=DOCS)

    assert _codes(report) == ["missing_sources"]


def test_unknown_document_is_reported_once() -> None:
    content = VALID_01 + "\nExtra [[doc:ghost.md]] and again [[doc:ghost.md]]\n"

    report = check_format("01", content, known_documents=DOCS)

    assert [(f.code, f.detail) for f in report.findings] == [("unknown_source", "ghost.md")]


def test_artifact_reference_counts_as_source_and_is_not_validated() -> None:
    content = VALID_01.replace("[[doc:interview.md]]", "[[artifact:abc]]").replace(
        "[[doc:kickoff.md]]", "[[artifact:abc]]"
    )

    assert check_format("01", content, known_documents=set()).ok


def test_stakeholder_item_missing_line_is_reported() -> None:
    content = VALID_02.replace("- Influence: medium\n", "")

    report = check_format("02", content, known_documents=DOCS)

    assert [(f.code, f.detail) for f in report.findings] == [
        ("missing_item_line", "Dispatcher / - Influence:")
    ]


def test_item_slot_without_items_is_reported() -> None:
    content = f"## 1. Stakeholder Identification & Classification\n\n{_REST_02}"

    report = check_format("02", content, known_documents=DOCS)

    assert _codes(report) == ["no_items"]


def test_sources_are_not_required_in_03() -> None:
    assert "[[" not in VALID_03
    assert check_format("03", VALID_03, known_documents=DOCS).ok


def test_vague_term_in_own_wording_is_reported_once() -> None:
    content = VALID_01.replace("Offer creation", "The tool must be fast and fast to learn.")

    report = check_format("01", content, known_documents=DOCS)

    assert [(f.code, f.detail) for f in report.findings] == [("vague_term", "fast")]


def test_vague_term_inside_quote_or_marker_is_ignored() -> None:
    content = (
        VALID_01
        + '\nSales says it must be "fast" [[doc:interview.md]]\n'
        + "- ? UNCLEAR: fast is not defined [[doc:interview.md]]\n"
        + "- ⚠ CONFLICT: easy vs hard [[doc:interview.md]] [[doc:kickoff.md]]\n"
    )

    assert check_format("01", content, known_documents=DOCS).ok


def test_vague_term_is_matched_as_a_word_only() -> None:
    content = VALID_01.replace("Offer creation", "Breakfast meetings are scheduled.")

    assert check_format("01", content, known_documents=DOCS).ok


def test_render_report_lists_one_line_per_finding_and_is_empty_when_ok() -> None:
    report = check_format("01", "", known_documents=set())
    assert render_report(report) == "- empty: The draft is empty."
    ok = check_format("03", "### Item\n**Question:** Q?", known_documents=set())
    assert render_report(ok) == ""


def test_german_vague_term_is_reported_with_inflection() -> None:
    own = "Das Tool muss schnelle und flexible Angebote liefern."
    content = VALID_01.replace("Offer creation", own)

    report = check_format("01", content, known_documents=DOCS)

    assert sorted((f.code, f.detail) for f in report.findings) == [
        ("vague_term", "flexibel"),
        ("vague_term", "schnell"),
    ]


def test_german_vague_term_inside_quote_is_ignored() -> None:
    content = VALID_01 + '\nDer Vertrieb fordert "schnell" [[doc:interview.md]]\n'

    assert check_format("01", content, known_documents=DOCS).ok


def test_german_vague_term_is_matched_as_a_word_only() -> None:
    content = VALID_01.replace("Offer creation", "Schnellstraßen und Einfachheit werden erwähnt.")

    assert check_format("01", content, known_documents=DOCS).ok


def test_a_heading_in_another_language_counts_by_its_number() -> None:
    content = VALID_01.replace("## 3. Problem Space", "## 3. Problemraum")

    assert check_format("01", content, known_documents=DOCS).ok


def test_a_heading_with_another_level_or_number_does_not_count() -> None:
    content = VALID_01.replace("## 3. Problem Space", "### 3. Problem Space").replace(
        "## 1. Executive Summary", "## 10. Executive Summary"
    )

    report = check_format("01", content, known_documents=DOCS)

    assert [f.detail for f in report.findings] == ["## 1. Executive Summary", "## 3. Problem Space"]
