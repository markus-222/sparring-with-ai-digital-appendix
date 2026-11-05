"""Runs table: background workflow executions and the per-project lock.

Revision ID: 011
Revises: 010
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "011"
down_revision: str | None = "010"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(10), nullable=False),
        sa.Column("slot", sa.String(2), nullable=False),
        sa.Column("state", sa.String(10), nullable=False),
        sa.Column("step", sa.String(40), nullable=True),
        sa.Column("error", sa.String(100), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("type IN ('draft', 'review')", name="ck_runs_type"),
        sa.CheckConstraint("slot IN ('01', '02', '03')", name="ck_runs_slot"),
        sa.CheckConstraint("state IN ('running', 'succeeded', 'failed')", name="ck_runs_state"),
    )
    op.create_index("ix_runs_project_id", "runs", ["project_id"])
    op.create_index(
        "uq_runs_one_running_per_project",
        "runs",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("state = 'running'"),
    )


def downgrade() -> None:
    op.drop_table("runs")
