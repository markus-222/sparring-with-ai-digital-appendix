"""Document Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    id: str
    project_id: str
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime

    model_config = {"from_attributes": True}
