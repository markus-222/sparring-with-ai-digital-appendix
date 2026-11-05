"""Drop chunk_count column from documents table (RAG removed)

Revision ID: 005
Revises: 004
Create Date: 2026-08-18
"""

import sqlalchemy as sa
from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("documents", "chunk_count")


def downgrade() -> None:
    op.add_column("documents", sa.Column("chunk_count", sa.Integer(), server_default="0"))
