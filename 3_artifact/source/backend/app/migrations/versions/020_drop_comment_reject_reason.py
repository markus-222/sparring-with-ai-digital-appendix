"""Drop comments.reject_reason: rejecting a comment takes no reason

Revision ID: 020
Revises: 019
Create Date: 2026-10-08
"""

import sqlalchemy as sa
from alembic import op

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("comments", "reject_reason")


def downgrade() -> None:
    op.add_column("comments", sa.Column("reject_reason", sa.Text(), nullable=True))
