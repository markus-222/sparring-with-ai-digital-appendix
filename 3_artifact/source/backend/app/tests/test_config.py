import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from app.config import Settings


@pytest.fixture(autouse=True)
def clean_settings_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "DATABASE_URL",
        "SECRET_KEY",
        "DEBUG",
        "ANTHROPIC_AUTH_TOKEN",
        "POSTGRES_HOST",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_PORT",
    ):
        monkeypatch.delenv(name, raising=False)


def test_database_url_uses_ssl_and_encodes_key_vault_credentials() -> None:
    settings = Settings(
        _env_file=None,
        DEBUG=False,
        SECRET_KEY="a-strong-secret",
        ANTHROPIC_AUTH_TOKEN="test-token",
        POSTGRES_HOST="postgres.example.com",
        POSTGRES_DB="aireprototype",
        POSTGRES_USER="app@servername",
        POSTGRES_PASSWORD="p@ss:word",
    )

    database_url = make_url(settings.DATABASE_URL)

    assert database_url.drivername == "postgresql+asyncpg"
    assert database_url.host == "postgres.example.com"
    assert database_url.port == 5432
    assert database_url.database == "aireprototype"
    assert database_url.username == "app@servername"
    assert database_url.password == "p@ss:word"
    assert database_url.query == {"ssl": "require"}


def test_explicit_database_url_takes_precedence_over_postgres_parts() -> None:
    database_url = "postgresql+asyncpg://local:local@db:5432/aireprototype"
    settings = Settings(
        _env_file=None,
        DATABASE_URL=database_url,
        POSTGRES_HOST="postgres.example.com",
        POSTGRES_DB="aireprototype",
        POSTGRES_USER="app@servername",
        POSTGRES_PASSWORD="p@ss:word",
    )

    assert settings.DATABASE_URL == database_url


def test_postgres_connection_parts_must_be_set_together() -> None:
    with pytest.raises(ValidationError, match="must be set together"):
        Settings(_env_file=None, POSTGRES_HOST="postgres.example.com")


def test_production_requires_a_non_default_secret_key() -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY must be set"):
        Settings(_env_file=None, DEBUG=False)


def test_production_requires_llm_token() -> None:
    with pytest.raises(ValidationError, match="ANTHROPIC_AUTH_TOKEN is required"):
        Settings(_env_file=None, DEBUG=False, SECRET_KEY="a-strong-secret")
