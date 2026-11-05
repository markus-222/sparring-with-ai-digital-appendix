"""Add full_text column to documents table

Revision ID: 002
Revises: 001
Create Date: 2026-06-23
"""

import sqlalchemy as sa
from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("full_text", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "full_text")
