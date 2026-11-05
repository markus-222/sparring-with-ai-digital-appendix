"""Server default for created_at on artifact_versions and workshop_questions.

Migration 008 created both columns NOT NULL without a default, while the
models rely on the database default.

Revision ID: 012
Revises: 011
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "012"
down_revision: str | None = "011"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None

_TABLES = ("artifact_versions", "workshop_questions")


def upgrade() -> None:
    for table in _TABLES:
        op.alter_column(table, "created_at", server_default=sa.func.now())


def downgrade() -> None:
    for table in _TABLES:
        op.alter_column(table, "created_at", server_default=None)
