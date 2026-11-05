"""workshop_questions.in_open_issues: question was written into artifact 03 directly.

Revision ID: 015
Revises: 014
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "015"
down_revision: str | None = "014"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.add_column(
        "workshop_questions",
        sa.Column("in_open_issues", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("workshop_questions", "in_open_issues")
