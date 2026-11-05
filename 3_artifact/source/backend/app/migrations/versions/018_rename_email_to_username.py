"""Rename users.email to users.username

Revision ID: 018
Revises: 017
Create Date: 2026-10-07
"""

from alembic import op

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.alter_column("users", "email", new_column_name="username")
    op.create_index("ix_users_username", "users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_username", table_name="users")
    op.alter_column("users", "username", new_column_name="email")
    op.create_index("ix_users_email", "users", ["email"], unique=True)
