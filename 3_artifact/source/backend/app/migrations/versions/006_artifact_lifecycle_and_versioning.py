"""Artifact lifecycle (draft/review/approved/discarded), project scope,
comments, and version history

Revision ID: 006
Revises: 005
Create Date: 2026-09-20 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- project_id: add nullable, backfill from session, then enforce ---
    op.add_column("artifacts", sa.Column("project_id", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE artifacts
        SET project_id = sessions.project_id
        FROM sessions
        WHERE artifacts.session_id = sessions.id
        """
    )
    op.alter_column("artifacts", "project_id", nullable=False)
    op.create_foreign_key(
        "artifacts_project_id_fkey", "artifacts", "projects", ["project_id"], ["id"]
    )
    op.create_index("ix_artifacts_project_id", "artifacts", ["project_id"])

    # --- session_id becomes provenance-only: nullable, ON DELETE SET NULL ---
    op.alter_column("artifacts", "session_id", nullable=True)
    op.drop_constraint("artifacts_session_id_fkey", "artifacts", type_="foreignkey")
    op.create_foreign_key(
        "artifacts_session_id_fkey",
        "artifacts",
        "sessions",
        ["session_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # --- status: pending/approved/rejected -> draft/review/approved/discarded ---
    op.execute("UPDATE artifacts SET status = 'draft' WHERE status = 'pending'")
    op.execute("UPDATE artifacts SET status = 'discarded' WHERE status = 'rejected'")
    op.alter_column("artifacts", "status", server_default="draft")

    # --- drop dead versioning columns (replaced by artifact_versions table) ---
    op.drop_constraint("artifacts_parent_id_fkey", "artifacts", type_="foreignkey")
    op.drop_column("artifacts", "parent_id")
    op.drop_column("artifacts", "version")

    # --- artifact_versions: real content history ---
    op.create_table(
        "artifact_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("artifact_id", sa.String(), sa.ForeignKey("artifacts.id"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("source", sa.String(30), nullable=False),
        sa.Column("created_by", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_artifact_versions_artifact_id", "artifact_versions", ["artifact_id"])

    # --- comments: per-item Critic/Explorer feedback ---
    op.create_table(
        "comments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("artifact_id", sa.String(), sa.ForeignKey("artifacts.id"), nullable=False),
        sa.Column("author_agent", sa.String(20), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("dismiss_reason", sa.Text(), nullable=True),
        sa.Column("trigger_source", sa.String(20), nullable=False),
        sa.Column("batch_id", sa.String(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index("ix_comments_artifact_id", "comments", ["artifact_id"])


def downgrade() -> None:
    op.drop_table("comments")
    op.drop_table("artifact_versions")

    op.add_column(
        "artifacts", sa.Column("version", sa.Integer(), nullable=False, server_default="1")
    )
    op.add_column(
        "artifacts",
        sa.Column("parent_id", sa.String(), sa.ForeignKey("artifacts.id"), nullable=True),
    )

    # Lossy: "review" has no pre-006 equivalent and collapses into "pending".
    op.execute("UPDATE artifacts SET status = 'pending' WHERE status IN ('draft', 'review')")
    op.execute("UPDATE artifacts SET status = 'rejected' WHERE status = 'discarded'")
    op.alter_column("artifacts", "status", server_default="pending")

    op.drop_constraint("artifacts_session_id_fkey", "artifacts", type_="foreignkey")
    op.create_foreign_key(
        "artifacts_session_id_fkey", "artifacts", "sessions", ["session_id"], ["id"]
    )
    op.alter_column("artifacts", "session_id", nullable=False)

    op.drop_index("ix_artifacts_project_id", table_name="artifacts")
    op.drop_constraint("artifacts_project_id_fkey", "artifacts", type_="foreignkey")
    op.drop_column("artifacts", "project_id")
