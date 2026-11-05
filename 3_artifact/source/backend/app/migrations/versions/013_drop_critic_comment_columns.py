"""Drop the Critic leftovers from comments; narrow sessions.chat_type to analyst.

Revision ID: 013
Revises: 012
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "013"
down_revision: str | None = "012"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.drop_column("comments", "critic_session")
    op.drop_column("comments", "category")
    op.drop_constraint("ck_sessions_chat_type", "sessions", type_="check")
    op.execute("UPDATE sessions SET chat_type = 'analyst' WHERE chat_type <> 'analyst'")
    op.create_check_constraint("ck_sessions_chat_type", "sessions", "chat_type IN ('analyst')")


def downgrade() -> None:
    op.drop_constraint("ck_sessions_chat_type", "sessions", type_="check")
    op.create_check_constraint(
        "ck_sessions_chat_type", "sessions", "chat_type IN ('analyst', 'critic', 'explorer')"
    )
    op.add_column("comments", sa.Column("category", sa.String(20), nullable=True))
    op.add_column(
        "comments",
        sa.Column(
            "critic_session",
            sa.String(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
