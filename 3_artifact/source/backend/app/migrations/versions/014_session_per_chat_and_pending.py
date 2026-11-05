"""Session per chat: drop chat_type, reviewed_artifact, draft_session; add sessions.pending.

Revision ID: 014
Revises: 013
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "014"
down_revision: str | None = "013"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.drop_constraint("ck_sessions_chat_type", "sessions", type_="check")
    op.drop_column("sessions", "chat_type")
    op.drop_constraint("fk_sessions_reviewed_artifact_artifacts", "sessions", type_="foreignkey")
    op.drop_column("sessions", "reviewed_artifact")
    op.drop_constraint("fk_artifacts_draft_session_sessions", "artifacts", type_="foreignkey")
    op.drop_column("artifacts", "draft_session")
    op.add_column("sessions", sa.Column("pending", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("sessions", "pending")
    op.add_column("artifacts", sa.Column("draft_session", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_artifacts_draft_session_sessions",
        "artifacts",
        "sessions",
        ["draft_session"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("sessions", sa.Column("reviewed_artifact", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_sessions_reviewed_artifact_artifacts",
        "sessions",
        "artifacts",
        ["reviewed_artifact"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "sessions",
        sa.Column("chat_type", sa.String(length=20), nullable=False, server_default="analyst"),
    )
    op.alter_column("sessions", "chat_type", server_default=None)
    op.create_check_constraint("ck_sessions_chat_type", "sessions", "chat_type IN ('analyst')")
