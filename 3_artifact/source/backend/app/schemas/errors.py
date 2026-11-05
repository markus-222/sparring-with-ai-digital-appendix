"""Error body shared by 409/501 answers."""

from pydantic import BaseModel


class ApiError(BaseModel):
    code: str
    message: str
