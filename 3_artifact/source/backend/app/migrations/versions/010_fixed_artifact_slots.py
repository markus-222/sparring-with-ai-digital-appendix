"""Fixed artifact slots 01-03: at most one artifact per slot type and project.

Revision ID: 010
Revises: 009
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "010"
down_revision: str | None = "009"
branch_labels: Sequence[str] | str | None = None
depends_on: Sequence[str] | str | None = None


def upgrade() -> None:
    # Slots are created with the project (slot_service.ensure_slots); no backfill:
    # the database starts empty.
    op.create_index(
        "uq_artifacts_project_slot_type",
        "artifacts",
        ["project_id", "type"],
        unique=True,
        postgresql_where=sa.text(
            "type IN ('project_description', 'stakeholder_analysis', 'open_issues')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_artifacts_project_slot_type", table_name="artifacts")
