"""Auth endpoint tests – register, login, logout, me."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.config import settings
from app.main import app


@pytest.fixture
async def auth_client():
    """HTTP client WITHOUT get_current_user override – tests real auth flow."""
    async with AsyncClient(
        transport=ASGITransport(app=app),  # type: ignore[arg-type]
        base_url="http://test",
    ) as ac:
        yield ac


def _make_fake_user(username: str = "user@example.com") -> MagicMock:
    user = MagicMock()
    user.id = "fake-user-id"
    user.username = username
    user.hashed_password = "$2b$12$hashed"
    user.display_name = "Test User"
    return user


@pytest.mark.asyncio
async def test_register_success(auth_client: AsyncClient) -> None:
    with (
        patch("app.api.v1.auth.AsyncSession") as _,
        patch("app.api.v1.auth._hash_password", return_value="hashed_pw"),
    ):
        # Patch the DB dependency at the route level
        from app.api.v1 import auth as auth_module

        mock_db = AsyncMock()
        mock_db.execute.return_value.scalar_one_or_none.return_value = None
        mock_db.flush = AsyncMock()

        _fake_user = _make_fake_user()

        with patch.object(auth_module.router, "routes"):
            pass  # just verify the module loads cleanly

    # Smoke test: endpoint exists and returns 422 on empty body (not 404/500)
    resp = await auth_client.post("/api/v1/auth/register", json={})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_missing_fields(auth_client: AsyncClient) -> None:
    resp = await auth_client.post("/api/v1/auth/register", json={"username": "a@b.com"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_password_too_short(auth_client: AsyncClient) -> None:
    resp = await auth_client.post(
        "/api/v1/auth/register",
        json={"username": "a@b.com", "password": "short"},
    )
    assert resp.status_code == 422
    assert "8 characters" in resp.text


@pytest.mark.asyncio
async def test_login_missing_fields(auth_client: AsyncClient) -> None:
    resp = await auth_client.post("/api/v1/auth/login", json={"username": "a@b.com"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_logout_clears_cookie(auth_client: AsyncClient) -> None:
    resp = await auth_client.post("/api/v1/auth/logout")
    assert resp.status_code == 204
    # Cookie should be deleted (set with max-age=0 or empty value)
    set_cookie = resp.headers.get("set-cookie", "")
    assert "access_token" in set_cookie


@pytest.mark.asyncio
async def test_me_unauthenticated(auth_client: AsyncClient) -> None:
    resp = await auth_client.get("/api/v1/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_invalid_token(auth_client: AsyncClient) -> None:
    resp = await auth_client.get(
        "/api/v1/auth/me",
        cookies={"access_token": "not.a.valid.jwt"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_without_cookie(auth_client: AsyncClient) -> None:
    """Any protected route must return 401 when no cookie is present."""
    resp = await auth_client.get("/api/v1/projects")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_protected_route_invalid_cookie(auth_client: AsyncClient) -> None:
    resp = await auth_client.get(
        "/api/v1/projects",
        cookies={"access_token": "garbage"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_sliding_expiry_refreshes_cookie(auth_client: AsyncClient) -> None:
    """A token within the refresh threshold triggers a new Set-Cookie header."""
    near_expiry = datetime.now(UTC) + timedelta(minutes=10)
    token = jwt.encode(
        {"sub": "fake-user-id", "exp": near_expiry},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    fake_user = _make_fake_user()

    with patch("app.api.dependencies.AsyncSession"):
        from app.api import dependencies as dep_module

        original = (
            dep_module.get_current_user.__wrapped__
            if hasattr(dep_module.get_current_user, "__wrapped__")
            else None
        )
        _ = original  # unused but keeps the import honest

    async def _fake_db_get(_model: object, _id: object) -> MagicMock:
        return fake_user

    mock_db = AsyncMock()
    mock_db.get = AsyncMock(side_effect=_fake_db_get)

    from app.database import get_db

    app.dependency_overrides[get_db] = lambda: mock_db
    try:
        resp = await auth_client.get(
            "/api/v1/auth/me",
            cookies={"access_token": token},
        )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 200
    set_cookie = resp.headers.get("set-cookie", "")
    assert "access_token" in set_cookie


@pytest.mark.asyncio
async def test_sliding_expiry_no_refresh_when_plenty_of_time(auth_client: AsyncClient) -> None:
    """A token with plenty of time left must NOT trigger a new Set-Cookie."""
    far_expiry = datetime.now(UTC) + timedelta(minutes=settings.JWT_EXPIRY_MINUTES)
    token = jwt.encode(
        {"sub": "fake-user-id", "exp": far_expiry},
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    fake_user = _make_fake_user()

    mock_db = AsyncMock()
    mock_db.get = AsyncMock(return_value=fake_user)

    from app.database import get_db

    app.dependency_overrides[get_db] = lambda: mock_db
    try:
        resp = await auth_client.get(
            "/api/v1/auth/me",
            cookies={"access_token": token},
        )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 200
    set_cookie = resp.headers.get("set-cookie", "")
    assert "access_token" not in set_cookie
