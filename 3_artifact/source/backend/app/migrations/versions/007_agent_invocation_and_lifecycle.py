"""Agent invocation & artifact lifecycle overhaul: chat_type, reviewed_artifact,
draft_session, flat draft/approved status, rewritten comments schema.

Revision ID: 007
Revises: 006
Create Date: 2026-09-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: str | None = "006"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    # --- sessions.chat_type: add nullable, backfill "analyst", make NOT NULL ---
    op.add_column("sessions", sa.Column("chat_type", sa.String(length=20), nullable=True))
    op.execute("UPDATE sessions SET chat_type = 'analyst' WHERE chat_type IS NULL")
    op.alter_column("sessions", "chat_type", nullable=False)
    op.create_check_constraint(
        "ck_sessions_chat_type",
        "sessions",
        "chat_type IN ('analyst', 'critic', 'explorer')",
    )

    # --- sessions.reviewed_artifact: nullable FK to artifacts.id ---
    op.add_column("sessions", sa.Column("reviewed_artifact", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_sessions_reviewed_artifact_artifacts",
        "sessions",
        "artifacts",
        ["reviewed_artifact"],
        ["id"],
        ondelete="SET NULL",
    )

    # --- artifacts.session_id -> draft_session (rename, keep FK/nullability) ---
    op.drop_constraint("artifacts_session_id_fkey", "artifacts", type_="foreignkey")
    op.alter_column("artifacts", "session_id", new_column_name="draft_session")
    op.create_foreign_key(
        "fk_artifacts_draft_session_sessions",
        "artifacts",
        "sessions",
        ["draft_session"],
        ["id"],
        ondelete="SET NULL",
    )

    # --- artifacts.status: collapse review/discarded into draft/approved ---
    op.execute("UPDATE artifacts SET status = 'draft' WHERE status IN ('review', 'discarded')")
    op.create_check_constraint(
        "ck_artifacts_status",
        "artifacts",
        "status IN ('draft', 'approved')",
    )

    # --- artifact_versions: dropped entirely (no version history) ---
    op.drop_table("artifact_versions")

    # --- comments: dropped and recreated with the new per-artifact-numbered shape ---
    op.drop_table("comments")
    op.create_table(
        "comments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "artifact_id",
            sa.String(),
            sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("review_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column(
            "critic_session",
            sa.String(),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "category IN ('issue', 'suggestion', 'missing')", name="ck_comments_category"
        ),
        sa.CheckConstraint("status IN ('open', 'resolved')", name="ck_comments_status"),
    )
    op.create_index("ix_comments_artifact_id", "comments", ["artifact_id"])
    op.create_unique_constraint(
        "uq_comments_artifact_id_number", "comments", ["artifact_id", "number"]
    )


def downgrade() -> None:
    # Lossy: number/review_number/title/sources/critic_session have no
    # pre-007 equivalent and are discarded; author_agent/dismiss_reason/
    # batch_id/display_order/trigger_source (pre-007 columns) are recreated
    # empty/default since the new schema never populated them.
    op.drop_table("comments")
    op.create_table(
        "comments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "artifact_id",
            sa.String(),
            sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("author_agent", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("dismiss_reason", sa.Text(), nullable=True),
        sa.Column("trigger_source", sa.String(length=20), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_comments_artifact_id", "comments", ["artifact_id"])

    op.create_table(
        "artifact_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "artifact_id",
            sa.String(),
            sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_artifact_versions_artifact_id", "artifact_versions", ["artifact_id"])

    # Lossy: approved artifacts changed after 007 cannot be told apart from
    # ones that were already draft — all collapse to 'draft' on the way back.
    op.drop_constraint("ck_artifacts_status", "artifacts", type_="check")

    op.drop_constraint("fk_artifacts_draft_session_sessions", "artifacts", type_="foreignkey")
    op.alter_column("artifacts", "draft_session", new_column_name="session_id")
    op.create_foreign_key(
        "artifacts_session_id_fkey",
        "artifacts",
        "sessions",
        ["session_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("fk_sessions_reviewed_artifact_artifacts", "sessions", type_="foreignkey")
    op.drop_column("sessions", "reviewed_artifact")

    op.drop_constraint("ck_sessions_chat_type", "sessions", type_="check")
    op.drop_column("sessions", "chat_type")
