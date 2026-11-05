"""Tests for document upload/download/view endpoints."""

from typing import cast

import pytest
from httpx import AsyncClient


async def _upload_txt(client: AsyncClient, project_id: str, filename: str = "notes.txt") -> str:
    """Helper: upload a small text file and return the resulting document ID."""
    resp = await client.post(
        f"/api/v1/documents/upload?project_id={project_id}",
        files={"file": (filename, b"Hello world", "text/plain")},
    )
    assert resp.status_code == 200
    return cast(str, resp.json()["id"])


@pytest.mark.integration
async def test_view_document_returns_inline_disposition(client):
    """GET /documents/:id/view serves content with Content-Disposition: inline."""
    proj = await client.post("/api/v1/projects", json={"name": "Test", "description": None})
    project_id = proj.json()["id"]
    document_id = await _upload_txt(client, project_id)

    resp = await client.get(f"/api/v1/documents/{document_id}/view")
    assert resp.status_code == 200
    assert resp.content == b"Hello world"
    assert resp.headers["content-type"].startswith("text/plain")
    assert resp.headers["content-disposition"].startswith("inline")
    assert "notes.txt" in resp.headers["content-disposition"]


@pytest.mark.integration
async def test_download_document_still_returns_attachment(client):
    """GET /documents/:id/download keeps forcing a file save."""
    proj = await client.post("/api/v1/projects", json={"name": "Test", "description": None})
    project_id = proj.json()["id"]
    document_id = await _upload_txt(client, project_id)

    resp = await client.get(f"/api/v1/documents/{document_id}/download")
    assert resp.status_code == 200
    assert resp.content == b"Hello world"
    assert resp.headers["content-disposition"].startswith("attachment")


@pytest.mark.integration
async def test_view_document_not_found(client):
    """GET /documents/:id/view returns 404 for an unknown document."""
    resp = await client.get("/api/v1/documents/does-not-exist/view")
    assert resp.status_code == 404


@pytest.mark.integration
async def test_download_document_not_found(client):
    """GET /documents/:id/download returns 404 for an unknown document."""
    resp = await client.get("/api/v1/documents/does-not-exist/download")
    assert resp.status_code == 404


@pytest.mark.parametrize(
    ("reported", "filename", "expected"),
    [
        # Windows browsers report no usable type for Markdown.
        ("application/octet-stream", "notes.md", "text/markdown"),
        ("", "notes.md", "text/markdown"),
        ("application/x-genesis-rom", "notes.md", "text/markdown"),
        ("text/plain", "NOTES.MD", "text/markdown"),
        ("application/octet-stream", "notes.txt", "text/plain"),
        ("application/octet-stream", "spec.pdf", "application/pdf"),
        (
            "application/octet-stream",
            "spec.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        # Unknown extensions keep the reported type and are rejected later.
        ("application/octet-stream", "tool.exe", "application/octet-stream"),
        ("text/plain", "README", "text/plain"),
    ],
)
def test_normalize_content_type_trusts_the_extension(
    reported: str, filename: str, expected: str
) -> None:
    from app.api.v1.documents import _normalize_content_type

    assert _normalize_content_type(reported, filename) == expected
