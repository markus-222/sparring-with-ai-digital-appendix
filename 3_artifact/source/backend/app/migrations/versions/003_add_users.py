"""Add users table and owner_id to projects

Revision ID: 003
Revises: 002
Create Date: 2026-06-30
"""

import sqlalchemy as sa
from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.add_column("projects", sa.Column("owner_id", sa.String(), nullable=True))
    op.create_foreign_key("fk_projects_owner_id", "projects", "users", ["owner_id"], ["id"])
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_projects_owner_id", table_name="projects")
    op.drop_constraint("fk_projects_owner_id", "projects", type_="foreignkey")
    op.drop_column("projects", "owner_id")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
