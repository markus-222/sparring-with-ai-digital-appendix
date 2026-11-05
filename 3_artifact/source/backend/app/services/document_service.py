"""Document processing service – orchestrates parse → persist."""

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document
from app.services.document_parser import DocumentParser


class DocumentService:
    """Orchestrates document ingestion: parse → persist full text."""

    def __init__(self) -> None:
        self.parser = DocumentParser()

    async def ingest(
        self,
        *,
        content: bytes,
        content_type: str,
        filename: str,
        project_id: str,
        db: AsyncSession,
    ) -> Document:
        """Full ingestion pipeline: parse → persist.

        Args:
            content: Raw file bytes.
            content_type: MIME type.
            filename: Original filename.
            project_id: Owning project ID.
            db: Database session.

        Returns:
            Persisted Document model instance.
        """
        # Parsing is CPU-bound and takes seconds; keep the event loop (and
        # /health) responsive while it runs.
        result = await asyncio.to_thread(self.parser.parse, content, content_type, filename)

        document = Document(
            id=str(uuid.uuid4()),
            project_id=project_id,
            filename=filename,
            content_type=content_type,
            size_bytes=len(content),
            full_text=result.text,
            raw_content=content,
        )
        db.add(document)
        await db.flush()

        return document

    async def list_documents(self, *, project_id: str, db: AsyncSession) -> list[Document]:
        """List all documents for a project."""
        stmt = select(Document).where(Document.project_id == project_id)
        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def get_content(self, *, document_id: str, db: AsyncSession) -> tuple[bytes, str, str]:
        """Return (body, content_type, filename) for a document's original file content.

        Args:
            document_id: The document to fetch content for.
            db: Database session.

        Returns:
            Tuple of (raw bytes, MIME type, filename) suitable for serving as a response body.

        Raises:
            ValueError: If the document doesn't exist or has no content available.
        """
        stmt = select(Document).where(Document.id == document_id)
        result = await db.execute(stmt)
        document = result.scalar_one_or_none()
        if not document:
            raise ValueError(f"Document not found: {document_id}")

        if document.raw_content:
            return document.raw_content, document.content_type, document.filename

        if document.full_text:
            # Fallback for documents ingested before migration 004
            return document.full_text.encode(), "text/plain; charset=utf-8", document.filename

        raise ValueError(f"No content available for document: {document_id}")

    async def replace_document(
        self,
        *,
        document_id: str,
        content: bytes,
        content_type: str,
        filename: str,
        db: AsyncSession,
    ) -> Document:
        """Replace a document: re-parse and overwrite the stored content.

        Args:
            document_id: Existing document ID to replace.
            content: New raw file bytes.
            content_type: MIME type of new file.
            filename: New filename.
            db: Database session.

        Returns:
            Updated Document model instance.

        Raises:
            ValueError: If document not found.
        """
        stmt = select(Document).where(Document.id == document_id)
        result = await db.execute(stmt)
        document = result.scalar_one_or_none()
        if not document:
            raise ValueError(f"Document not found: {document_id}")

        parse_result = await asyncio.to_thread(self.parser.parse, content, content_type, filename)

        document.filename = filename
        document.content_type = content_type
        document.size_bytes = len(content)
        document.full_text = parse_result.text
        document.raw_content = content
        await db.flush()
        await db.refresh(document)

        return document

    async def delete_document(self, *, document_id: str, db: AsyncSession) -> None:
        """Delete a document.

        Args:
            document_id: The document to delete.
            db: Database session.
        """
        stmt = select(Document).where(Document.id == document_id)
        result = await db.execute(stmt)
        document = result.scalar_one_or_none()
        if document:
            await db.delete(document)
            await db.flush()
