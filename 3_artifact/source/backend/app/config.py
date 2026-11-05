from typing import Self

from pydantic import model_validator
from pydantic_settings import BaseSettings
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    # Database: explicit DATABASE_URL wins; otherwise build one from POSTGRES_*.
    DATABASE_URL: str = ""
    POSTGRES_HOST: str = ""
    POSTGRES_USER: str = ""
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = ""
    POSTGRES_PORT: int = 5432

    # Backend
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    SECRET_KEY: str = "change-me-in-production"
    DEBUG: bool = True
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_MINUTES: int = 180  # Token expiration time (3 hours)
    JWT_REFRESH_THRESHOLD_MINUTES: int = 10  # re-issue cookie when < 10 min left

    # Explicit timeouts on every external call. A hung provider connection
    # must not pin a run or a pooled DB connection.
    LLM_TIMEOUT_SECONDS: float = 120.0  # single non-streaming call
    LLM_STREAM_IDLE_TIMEOUT_SECONDS: float = 60.0  # max gap between stream chunks

    # Runtime resilience: concurrency cap + retry on 429/503 with
    # exponential backoff and jitter (Retry-After is respected).
    LLM_MAX_CONCURRENCY: int = 4
    LLM_MAX_RETRIES: int = 3
    LLM_RETRY_BASE_DELAY: float = 1.0
    LLM_RETRY_MAX_DELAY: float = 20.0

    # A whole run (several LLM calls) must end within this budget.
    RUN_TIMEOUT_SECONDS: float = 600.0

    # Anthropic (Claude)
    ANTHROPIC_AUTH_TOKEN: str = ""
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com"
    ANTHROPIC_MODEL: str = "claude-sonnet-5-5"

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    @model_validator(mode="after")
    def configure_deployment_settings(self) -> Self:
        if not self.DATABASE_URL:
            postgres_parts = (
                self.POSTGRES_HOST,
                self.POSTGRES_DB,
                self.POSTGRES_USER,
                self.POSTGRES_PASSWORD,
            )
            if any(postgres_parts):
                if not all(postgres_parts):
                    raise ValueError(
                        "POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, and "
                        "POSTGRES_PASSWORD must be set together"
                    )
                self.DATABASE_URL = URL.create(
                    drivername="postgresql+asyncpg",
                    username=self.POSTGRES_USER,
                    password=self.POSTGRES_PASSWORD,
                    host=self.POSTGRES_HOST,
                    port=self.POSTGRES_PORT,
                    database=self.POSTGRES_DB,
                    query={"ssl": "require"},
                ).render_as_string(hide_password=False)
            else:
                self.DATABASE_URL = "postgresql+asyncpg://postgres:postgres@db:5432/aireprototype"

        if not self.DEBUG:
            if not self.SECRET_KEY or self.SECRET_KEY == "change-me-in-production":
                raise ValueError("SECRET_KEY must be set when DEBUG is false")
            if not self.ANTHROPIC_AUTH_TOKEN.strip():
                raise ValueError("ANTHROPIC_AUTH_TOKEN is required when DEBUG is false")

        return self

    @property
    def llm_model(self) -> str:
        """Get the active LLM model name."""
        return self.ANTHROPIC_MODEL

    @property
    def litellm_model(self) -> str:
        """Get the LiteLLM model string."""
        return f"anthropic/{self.ANTHROPIC_MODEL}"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
