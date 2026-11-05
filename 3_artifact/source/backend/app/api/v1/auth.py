"""Auth routes – register, login, logout, me."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    UpdateProfileRequest,
    UserResponse,
)

router = APIRouter()
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _hash_password(password: str) -> str:
    return str(_pwd_context.hash(password))


def _verify_password(plain: str, hashed: str) -> bool:
    return bool(_pwd_context.verify(plain, hashed))


def _get_token_expiry(request: Request) -> datetime | None:
    """Decode the JWT from the cookie and return its expiry as a datetime."""
    token = request.cookies.get("access_token", "")
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        exp: int | None = payload.get("exp")
        if exp is None:
            return None
        return datetime.fromtimestamp(int(exp), tz=UTC)
    except Exception:
        return None


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
        secure=False,  # set True behind HTTPS in production
        samesite="lax",
        max_age=settings.JWT_EXPIRY_MINUTES * 60,
    )


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(
    body: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        username=body.username,
        hashed_password=_hash_password(body.password),
        display_name=body.display_name,
    )
    db.add(user)
    await db.flush()

    _set_auth_cookie(response, _create_token(user.id))
    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        session_expires_at=datetime.now(UTC) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES),
    )


@router.post("/login", response_model=UserResponse)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if not user or not _verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    _set_auth_cookie(response, _create_token(user.id))
    return UserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        session_expires_at=datetime.now(UTC) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES),
    )


@router.post("/logout", status_code=204)
async def logout(response: Response) -> None:
    response.delete_cookie(key="access_token")


@router.get("/me", response_model=UserResponse)
async def me(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Return current user with the actual token expiry embedded."""
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        session_expires_at=_get_token_expiry(request),
    )


@router.put("/profile", response_model=UserResponse)
async def update_profile(
    request: Request,
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Update current user's profile (display_name)."""
    if body.display_name is not None:
        current_user.display_name = body.display_name.strip()

    db.add(current_user)
    await db.flush()
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        session_expires_at=_get_token_expiry(request),
    )
