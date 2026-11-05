"""Comment redesign: role, hypothesis, suggestion, five statuses.

Revision ID: 009
Revises: 008
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "009"
down_revision: str | None = "008"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    # --- role: reviewer|explorer, legacy rows backfill to reviewer ---
    op.add_column("comments", sa.Column("role", sa.String(length=10), nullable=True))
    op.execute("UPDATE comments SET role = 'reviewer' WHERE role IS NULL")
    op.alter_column("comments", "role", existing_type=sa.String(length=10), nullable=False)
    op.create_check_constraint("ck_comments_role", "comments", "role IN ('reviewer', 'explorer')")

    # --- hypothesis, suggestion (validated by Pydantic in the service), reject_reason ---
    op.add_column(
        "comments",
        sa.Column("hypothesis", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("comments", sa.Column("suggestion", sa.JSON(), nullable=True))
    op.add_column("comments", sa.Column("reject_reason", sa.Text(), nullable=True))

    # --- status: five values, legacy 'resolved' -> 'done_manually' ---
    op.drop_constraint("ck_comments_status", "comments", type_="check")
    op.execute("UPDATE comments SET status = 'done_manually' WHERE status = 'resolved'")
    op.create_check_constraint(
        "ck_comments_status",
        "comments",
        "status IN ('open', 'accepted', 'edited', 'rejected', 'done_manually')",
    )

    # --- category dropped from the model's domain; critic_session optional ---
    op.drop_constraint("ck_comments_category", "comments", type_="check")
    op.alter_column("comments", "category", existing_type=sa.String(length=20), nullable=True)
    op.alter_column("comments", "critic_session", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    # Lossy: comments created after 009 have no critic_session and cannot exist
    # before it; accepted/edited/rejected statuses collapse to resolved.
    op.execute("DELETE FROM comments WHERE critic_session IS NULL")
    op.execute("UPDATE comments SET category = 'issue' WHERE category IS NULL")
    op.alter_column("comments", "critic_session", existing_type=sa.String(), nullable=False)
    op.alter_column("comments", "category", existing_type=sa.String(length=20), nullable=False)
    op.create_check_constraint(
        "ck_comments_category", "comments", "category IN ('issue', 'suggestion', 'missing')"
    )
    op.drop_constraint("ck_comments_status", "comments", type_="check")
    op.execute("UPDATE comments SET status = 'resolved' WHERE status <> 'open'")
    op.create_check_constraint("ck_comments_status", "comments", "status IN ('open', 'resolved')")
    op.drop_column("comments", "reject_reason")
    op.drop_column("comments", "suggestion")
    op.drop_column("comments", "hypothesis")
    op.drop_constraint("ck_comments_role", "comments", type_="check")
    op.drop_column("comments", "role")
