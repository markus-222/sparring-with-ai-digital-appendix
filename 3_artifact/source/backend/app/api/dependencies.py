"""FastAPI dependencies – reusable across route handlers."""

from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, Response
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.infra.llm import LLMClient
from app.models.user import User
from app.services.chat_service import ChatService
from app.services.run_manager import RunManager


def get_llm(request: Request) -> LLMClient:
    """The process-wide LLM client created in lifespan (app.state.llm)."""
    llm: LLMClient = request.app.state.llm
    return llm


def get_run_manager(request: Request) -> RunManager:
    """The process-wide run manager created in lifespan (app.state.run_manager)."""
    manager: RunManager = request.app.state.run_manager
    return manager


def get_chat_service(
    llm: LLMClient = Depends(get_llm), run_manager: RunManager = Depends(get_run_manager)
) -> ChatService:
    return ChatService(llm, run_manager)


def _create_token(user_id: str) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    return str(
        jwt.encode(
            {"sub": user_id, "exp": expire},
            settings.SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )
    )


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.JWT_EXPIRY_MINUTES * 60,
    )


async def get_current_user(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate the JWT from the httpOnly cookie."""
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id: str | None = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    exp: int | None = payload.get("exp")
    if exp is not None:
        time_left = exp - datetime.now(UTC).timestamp()
        if time_left < settings.JWT_REFRESH_THRESHOLD_MINUTES * 60:
            _set_auth_cookie(response, _create_token(user_id))

    return user
