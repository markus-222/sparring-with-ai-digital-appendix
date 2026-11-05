"""Document parsing – extracts Markdown-flavoured text from PDF, DOCX, and TXT files.

PDFs are parsed with pdfplumber, DOCX with python-docx. Both are pure Python:
the parser runs inside the API process and must stay small in memory. Tables
(and DOCX headings and lists) are emitted as Markdown so the agents keep the
document structure. Plain text / markdown files are read directly.
"""

import logging
from collections.abc import Sequence
from io import BytesIO
from typing import Any

import pdfplumber
from docx import Document as DocxDocument
from docx.table import Table as DocxTable
from docx.text.paragraph import Paragraph
from pdfplumber.page import Page

logger = logging.getLogger(__name__)

_BBox = tuple[float, float, float, float]


class ParseResult:
    """Result of parsing a document."""

    def __init__(self, text: str, metadata: dict[str, Any]) -> None:
        self.text = text
        self.metadata = metadata


def _cell_text(cell: str | None) -> str:
    """Flatten a table cell to one Markdown-safe line."""
    return " ".join((cell or "").split()).replace("|", "\\|")


def _table_to_markdown(rows: Sequence[Sequence[str | None]]) -> str:
    """Render table rows as Markdown; the first row is the header.

    A table with a single row or a single column carries no tabular structure
    (PDF table detection also reports framed text boxes), so it is emitted as
    plain lines.
    """
    cells = [[_cell_text(cell) for cell in row] for row in rows]
    cells = [row for row in cells if any(row)]
    if not cells:
        return ""
    width = max(len(row) for row in cells)
    if len(cells) < 2 or width < 2:
        return "\n".join(" ".join(cell for cell in row if cell) for row in cells)

    padded = [row + [""] * (width - len(row)) for row in cells]
    lines = ["| " + " | ".join(row) + " |" for row in padded]
    lines.insert(1, "| " + " | ".join(["---"] * width) + " |")
    return "\n".join(lines)


def _inside(obj: dict[str, Any], bboxes: Sequence[_BBox]) -> bool:
    """True if the centre of a PDF object lies inside one of the bounding boxes."""
    x = (obj["x0"] + obj["x1"]) / 2
    y = (obj["top"] + obj["bottom"]) / 2
    return any(x0 <= x <= x1 and top <= y <= bottom for x0, top, x1, bottom in bboxes)


def _pdf_page_to_markdown(page: Page) -> str:
    """Extract a page top to bottom: text lines, with tables as Markdown."""
    tables = page.find_tables()
    if not tables:
        return page.extract_text() or ""

    bboxes: list[_BBox] = [table.bbox for table in tables]
    outside = page.filter(lambda obj: not _inside(obj, bboxes))

    # (top position, is_table, text) so the blocks keep their reading order.
    blocks: list[tuple[float, bool, str]] = [
        (float(line["top"]), False, str(line["text"])) for line in outside.extract_text_lines()
    ]
    for table in tables:
        markdown = _table_to_markdown(table.extract())
        if markdown:
            blocks.append((float(table.bbox[1]), True, markdown))
    blocks.sort(key=lambda block: block[0])

    parts: list[str] = []
    previous_was_table = False
    for index, (_, is_table, text) in enumerate(blocks):
        if index > 0:
            parts.append("\n\n" if is_table or previous_was_table else "\n")
        parts.append(text)
        previous_was_table = is_table
    return "".join(parts)


def _docx_paragraph_to_markdown(paragraph: Paragraph) -> str:
    """Render a DOCX paragraph, keeping headings and list items as Markdown."""
    text = paragraph.text.strip()
    if not text:
        return ""
    style = (paragraph.style.name if paragraph.style is not None else None) or ""
    if style == "Title":
        return f"# {text}"
    if style.startswith("Heading "):
        level = style.removeprefix("Heading ")
        if level.isdigit():
            return f"{'#' * min(int(level), 6)} {text}"
    if style.startswith("List Bullet"):
        return f"- {text}"
    if style.startswith("List Number"):
        return f"1. {text}"
    return text


class DocumentParser:
    """Extracts text from uploaded files based on content type.

    PDF: pdfplumber. DOCX: python-docx. Tables become Markdown tables.
    TXT/Markdown: direct UTF-8 decode.
    """

    SUPPORTED_TYPES: dict[str, str] = {
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "text/plain": "txt",
        "text/markdown": "txt",
    }

    def parse(self, content: bytes, content_type: str, filename: str) -> ParseResult:
        """Parse document content to plain text.

        Args:
            content: Raw file bytes.
            content_type: MIME type of the file.
            filename: Original filename.

        Returns:
            ParseResult with extracted text and metadata.

        Raises:
            ValueError: If content_type is not supported.
        """
        file_type = self.SUPPORTED_TYPES.get(content_type)
        if file_type is None:
            raise ValueError(
                f"Unsupported content type: {content_type}. "
                f"Supported: {list(self.SUPPORTED_TYPES.keys())}"
            )

        if file_type == "pdf":
            text, metadata = self._parse_pdf(content, filename)
        elif file_type == "docx":
            text, metadata = self._parse_docx(content, filename)
        else:
            text, metadata = self._parse_txt(content, filename)

        return ParseResult(text=text, metadata=metadata)

    def _parse_pdf(self, content: bytes, filename: str) -> tuple[str, dict[str, Any]]:
        """Extract text from a PDF page by page, with tables as Markdown."""
        pages: list[str] = []
        with pdfplumber.open(BytesIO(content)) as pdf:
            for page in pdf.pages:
                try:
                    page_text = _pdf_page_to_markdown(page)
                except Exception as e:
                    # Table detection can fail on unusual layouts; the plain
                    # text of the page is still worth keeping.
                    logger.warning(
                        f"Table extraction failed for {filename} "
                        f"page {page.page_number}: {type(e).__name__}"
                    )
                    page_text = page.extract_text() or ""
                if page_text.strip():
                    pages.append(page_text)
                # pdfplumber caches every parsed page; release it so memory
                # stays flat on long documents.
                page.close()

        return "\n\n".join(pages), {
            "filename": filename,
            "format": "pdf",
            "page_count": len(pages),
            "parser": "pdfplumber",
        }

    def _parse_docx(self, content: bytes, filename: str) -> tuple[str, dict[str, Any]]:
        """Extract a DOCX in document order: headings, lists and tables as Markdown."""
        doc = DocxDocument(BytesIO(content))
        blocks: list[str] = []
        for item in doc.iter_inner_content():
            if isinstance(item, DocxTable):
                block = _table_to_markdown([[cell.text for cell in row.cells] for row in item.rows])
            else:
                block = _docx_paragraph_to_markdown(item)
            if block:
                blocks.append(block)

        return "\n\n".join(blocks), {
            "filename": filename,
            "format": "docx",
            "paragraph_count": len(blocks),
            "parser": "python-docx",
        }

    def _parse_txt(self, content: bytes, filename: str) -> tuple[str, dict[str, Any]]:
        """Extract text from plain text / markdown."""
        text = content.decode("utf-8", errors="replace")

        return text, {
            "filename": filename,
            "format": "txt",
            "char_count": len(text),
            "parser": "direct",
        }
