"""Drop sessions.pending: the chat keeps no pending action between turns

Revision ID: 019
Revises: 018
Create Date: 2026-10-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("sessions", "pending")


def downgrade() -> None:
    op.add_column("sessions", sa.Column("pending", postgresql.JSONB(), nullable=True))
