"""Auth Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, field_validator


class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str | None = None

    @field_validator("username")
    @classmethod
    def username_not_empty(cls, v: str) -> str:
        if len(v.strip()) == 0:
            raise ValueError("Username cannot be empty")
        return v

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    username: str
    display_name: str | None
    session_expires_at: datetime | None = None

    model_config = {"from_attributes": True}


class UpdateProfileRequest(BaseModel):
    display_name: str | None = None

    @field_validator("display_name")
    @classmethod
    def display_name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and len(v.strip()) == 0:
            raise ValueError("Display name cannot be empty")
        return v
