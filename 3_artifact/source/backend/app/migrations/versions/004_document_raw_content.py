"""Add raw_content column to documents table for original-file download

Revision ID: 004
Revises: 003
Create Date: 2026-07-02
"""

import sqlalchemy as sa
from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("raw_content", sa.LargeBinary, nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "raw_content")
