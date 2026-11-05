from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.document import DocumentResponse
from app.services.document_service import DocumentService

router = APIRouter()

# Singleton service instance
_service = DocumentService()

# Supported MIME types (exposed from service layer for validation)
SUPPORTED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
}


# File extension -> MIME type. The extension is authoritative for these.
_EXTENSION_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
}


def _normalize_content_type(content_type: str, filename: str) -> str:
    """Derive the MIME type from the file extension, not from the browser.

    The browser-reported type depends on the uploader's OS: Windows has no
    registered type for `.md` and reports `application/octet-stream` (or an
    empty or unrelated type), macOS reports `text/markdown` or `text/plain`.
    For the extensions we support, trust the extension so an upload behaves
    the same on every client and Markdown is stored as `text/markdown` (the
    frontend's DocumentViewer renders by stored type). Unknown extensions
    keep the reported type and are validated against SUPPORTED_TYPES.
    """
    for extension, mime_type in _EXTENSION_TYPES.items():
        if filename.lower().endswith(extension):
            return mime_type
    return content_type


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DocumentResponse:
    """Upload and process a document.

    Supported formats: PDF, DOCX, TXT, Markdown.
    """
    content_type = file.content_type or "application/octet-stream"
    content_type = _normalize_content_type(content_type, file.filename or "")
    if content_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. "
            f"Supported: {sorted(SUPPORTED_TYPES)}",
        )

    content = await file.read()
    filename = file.filename or "unnamed"

    document = await _service.ingest(
        content=content,
        content_type=content_type,
        filename=filename,
        project_id=project_id,
        db=db,
    )

    return DocumentResponse.model_validate(document)


@router.get("", response_model=list[DocumentResponse])
async def list_documents(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[DocumentResponse]:
    """List documents for a project."""
    documents = await _service.list_documents(project_id=project_id, db=db)
    return [DocumentResponse.model_validate(d) for d in documents]


@router.put("/{document_id}", response_model=DocumentResponse)
async def replace_document(
    document_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DocumentResponse:
    """Replace a document – re-parses and overwrites the stored content.

    Use this when a document has been updated.
    """
    content_type = file.content_type or "application/octet-stream"
    content_type = _normalize_content_type(content_type, file.filename or "")
    if content_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. "
            f"Supported: {sorted(SUPPORTED_TYPES)}",
        )

    content = await file.read()
    filename = file.filename or "unnamed"

    try:
        document = await _service.replace_document(
            document_id=document_id,
            content=content,
            content_type=content_type,
            filename=filename,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    return DocumentResponse.model_validate(document)


@router.get("/{document_id}/download")
async def download_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    """Download the original uploaded file bytes."""
    try:
        body, content_type, filename = await _service.get_content(document_id=document_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(body)),
        },
    )


@router.get("/{document_id}/view")
async def view_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    """Serve the original uploaded file bytes for inline viewing in the browser."""
    try:
        body, content_type, filename = await _service.get_content(document_id=document_id, db=db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Content-Length": str(len(body)),
        },
    )


@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict[str, str]:
    """Delete a document."""
    await _service.delete_document(document_id=document_id, db=db)
    return {"status": "deleted", "document_id": document_id}
