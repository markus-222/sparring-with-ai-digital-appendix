from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WorkshopQuestionResponse(BaseModel):
    id: str
    text: str
    origin_artifact_id: str | None
    origin_comment_id: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
