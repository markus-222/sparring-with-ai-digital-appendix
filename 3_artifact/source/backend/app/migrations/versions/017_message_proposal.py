"""Add messages.proposal: the question proposal card of an assistant message.

Revision ID: 017
Revises: 016
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: str | None = "016"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("proposal", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "proposal")
