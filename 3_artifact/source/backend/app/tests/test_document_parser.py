"""Tests for document text extraction."""

import pytest

from app.services.document_parser import DocumentParser, ParseResult


class TestDocumentParser:
    """Test document parsing."""

    def test_parse_txt(self):
        """Parse plain text."""
        parser = DocumentParser()
        result = parser.parse(b"Hello world", "text/plain", "test.txt")
        assert isinstance(result, ParseResult)
        assert result.text == "Hello world"
        assert result.metadata["format"] == "txt"
        assert result.metadata["filename"] == "test.txt"

    def test_parse_markdown(self):
        """Parse markdown as text."""
        parser = DocumentParser()
        result = parser.parse(b"# Title\n\nBody", "text/markdown", "README.md")
        assert "# Title" in result.text
        assert result.metadata["format"] == "txt"

    def test_parse_unsupported_type(self):
        """Reject unsupported MIME types."""
        parser = DocumentParser()
        with pytest.raises(ValueError, match="Unsupported content type"):
            parser.parse(b"data", "application/zip", "archive.zip")

    def test_parse_pdf_minimal(self):
        """Parse a minimal PDF (requires pdfplumber)."""
        # Create a minimal valid PDF
        # This tests that pdfplumber is importable and works
        parser = DocumentParser()
        # Minimal PDF that pdfplumber can open (empty page)
        minimal_pdf = (
            b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
            b"0000000058 00000 n \n0000000115 00000 n \n"
            b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
        )
        result = parser.parse(minimal_pdf, "application/pdf", "test.pdf")
        assert result.metadata["format"] == "pdf"


def _pdf_with_table() -> bytes:
    """A one-page PDF: a heading line, a ruled 3x2 table, a closing line."""
    top, cols, rows = 700, [50, 150, 400, 545], 3
    ops = ["BT /F1 12 Tf 50 760 Td (Functional requirements) Tj ET"]
    for r in range(rows + 1):
        ops.append(f"{cols[0]} {top - r * 20} m {cols[-1]} {top - r * 20} l S")
    for x in cols:
        ops.append(f"{x} {top} m {x} {top - rows * 20} l S")
    table = [
        ["ID", "Requirement", "Priority"],
        ["REQ-1", "Upload a PDF", "High"],
        ["REQ-2", "Upload a DOCX", "Low"],
    ]
    for r, row in enumerate(table):
        for k, cell in enumerate(row):
            ops.append(f"BT /F1 9 Tf {cols[k] + 4} {top - r * 20 - 14} Td ({cell}) Tj ET")
    ops.append("BT /F1 12 Tf 50 600 Td (End of section) Tj ET")
    body = "\n".join(ops)
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R "
        "/Resources << /Font << /F1 3 0 R >> >> >>",
        f"<< /Length {len(body)} >>\nstream\n{body}\nendstream",
    ]
    out = "%PDF-1.4\n"
    offsets = []
    for n, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{obj}\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n"
    out += "".join(f"{off:010d} 00000 n \n" for off in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode()


class TestStructuredParsing:
    """PDF and DOCX keep their structure as Markdown, without an ML parser."""

    def test_pdf_table_becomes_markdown_in_reading_order(self):
        result = DocumentParser().parse(_pdf_with_table(), "application/pdf", "spec.pdf")

        assert result.metadata["parser"] == "pdfplumber"
        assert "| ID | Requirement | Priority |" in result.text
        assert "| --- | --- | --- |" in result.text
        assert "| REQ-2 | Upload a DOCX | Low |" in result.text
        # Table cells are not repeated as loose text lines.
        assert result.text.count("REQ-1") == 1
        heading = result.text.index("Functional requirements")
        table = result.text.index("| ID |")
        closing = result.text.index("End of section")
        assert heading < table < closing

    def test_docx_headings_lists_and_tables_become_markdown(self):
        from io import BytesIO

        from docx import Document

        doc = Document()
        doc.add_heading("Scope", level=1)
        doc.add_paragraph("The system handles uploads.")
        doc.add_heading("Details", level=2)
        doc.add_paragraph("First point", style="List Bullet")
        table = doc.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "ID"
        table.cell(0, 1).text = "Text | note"
        table.cell(1, 0).text = "REQ-1"
        table.cell(1, 1).text = "Upload"
        doc.add_paragraph("After the table.")
        buffer = BytesIO()
        doc.save(buffer)

        result = DocumentParser().parse(
            buffer.getvalue(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "spec.docx",
        )

        assert result.metadata["parser"] == "python-docx"
        assert "# Scope" in result.text
        assert "## Details" in result.text
        assert "- First point" in result.text
        assert "| ID | Text \\| note |" in result.text
        assert "| REQ-1 | Upload |" in result.text
        assert result.text.index("| REQ-1") < result.text.index("After the table.")

    def test_parser_does_not_load_an_ml_stack(self):
        """Docling/PyTorch got the pod OOM-killed; parsing must stay pure Python."""
        import sys

        DocumentParser().parse(_pdf_with_table(), "application/pdf", "spec.pdf")
        assert "docling" not in sys.modules
        assert "torch" not in sys.modules
