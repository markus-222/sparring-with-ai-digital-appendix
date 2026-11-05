"""Artifact SQLAlchemy model – project-scoped HITL lifecycle."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (
        Index(
            "uq_artifacts_project_slot_type",
            "project_id",
            "type",
            unique=True,
            postgresql_where=text(
                "type IN ('project_description', 'stakeholder_analysis', 'open_issues')"
            ),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("projects.id"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON, nullable=True)

    # not_started -> draft <-> approved (editing an approved artifact reverts to draft)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    reviewed_since_change: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project = relationship("Project", back_populates="artifacts")
    comments = relationship("Comment", back_populates="artifact", cascade="all, delete-orphan")
