"""Run model: one background workflow execution; the running row is the project lock."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint("type IN ('draft', 'review')", name="ck_runs_type"),
        CheckConstraint("slot IN ('01', '02', '03')", name="ck_runs_slot"),
        CheckConstraint("state IN ('running', 'succeeded', 'failed')", name="ck_runs_state"),
        Index(
            "uq_runs_one_running_per_project",
            "project_id",
            unique=True,
            postgresql_where=text("state = 'running'"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(10), nullable=False)
    slot: Mapped[str] = mapped_column(String(2), nullable=False)
    state: Mapped[str] = mapped_column(String(10), nullable=False, default="running")
    step: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
