"""Drop workshop_questions.in_open_issues: the new-questions hint it fed is gone.

Revision ID: 016
Revises: 015
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "016"
down_revision: str | None = "015"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.drop_column("workshop_questions", "in_open_issues")


def downgrade() -> None:
    op.add_column(
        "workshop_questions",
        sa.Column("in_open_issues", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
