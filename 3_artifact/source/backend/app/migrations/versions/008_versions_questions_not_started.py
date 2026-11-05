"""Approved versions, workshop questions, not_started status, review flag.

Revision ID: 008
Revises: 007
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "008"
down_revision: str | None = "007"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    # --- artifacts.status: allow not_started in addition to draft/approved ---
    op.drop_constraint("ck_artifacts_status", "artifacts", type_="check")
    op.create_check_constraint(
        "ck_artifacts_status",
        "artifacts",
        "status IN ('not_started', 'draft', 'approved')",
    )

    # --- artifacts.reviewed_since_change: review-needed flag ---
    op.add_column(
        "artifacts",
        sa.Column("reviewed_since_change", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    # --- artifact_versions: approved versions only ---
    op.create_table(
        "artifact_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "artifact_id",
            sa.String(),
            sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("artifact_id", "version_no", name="uq_artifact_versions_artifact_no"),
    )
    op.create_index("ix_artifact_versions_artifact_id", "artifact_versions", ["artifact_id"])

    # --- workshop_questions: project-wide accepted questions (no FK on origin_comment_id yet) ---
    op.create_table(
        "workshop_questions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "origin_artifact_id",
            sa.String(),
            sa.ForeignKey("artifacts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("origin_comment_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_workshop_questions_project_id", "workshop_questions", ["project_id"])


def downgrade() -> None:
    # Lossy: approved versions and workshop questions are discarded;
    # not_started artifacts collapse to draft.
    op.drop_table("workshop_questions")
    op.drop_table("artifact_versions")
    op.drop_column("artifacts", "reviewed_since_change")
    op.execute("UPDATE artifacts SET status = 'draft' WHERE status = 'not_started'")
    op.drop_constraint("ck_artifacts_status", "artifacts", type_="check")
    op.create_check_constraint(
        "ck_artifacts_status",
        "artifacts",
        "status IN ('draft', 'approved')",
    )
