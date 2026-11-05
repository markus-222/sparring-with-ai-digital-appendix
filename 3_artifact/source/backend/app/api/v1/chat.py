"""Chat endpoint: one SSE stream per user message. The turn itself runs in ChatService."""

import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_chat_service, get_current_user
from app.api.errors import verify_session_owner
from app.database import get_db
from app.models.user import User
from app.schemas.chat import ChatRequest, ErrorEvent
from app.services.chat_service import ChatService

logger = logging.getLogger(__name__)

router = APIRouter()


def _sse(name: str, data: BaseModel | str) -> str:
    if isinstance(data, str):
        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
    return f"event: {name}\ndata: {data.model_dump_json()}\n\n"


def _error(message: str) -> str:
    return _sse("error", ErrorEvent(message=message))


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
) -> StreamingResponse:
    """Server-Sent Events: token (JSON string), status, chip_cleared, artifact_changed,
    open_artifact, run_started, proposal_settled, done, error."""
    session = await verify_session_owner(db, request.session_id, current_user.id)

    async def event_generator() -> AsyncIterator[str]:
        try:
            async for name, data in service.stream(db, session, request):
                yield _sse(name, data)
        except Exception:
            logger.exception("chat stream failed")
            # get_db commits when the generator ends: do not keep a half turn.
            await db.rollback()
            yield _error("Internal error")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
