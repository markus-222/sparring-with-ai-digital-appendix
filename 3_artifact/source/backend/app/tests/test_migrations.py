"""Smoke tests for schema migrations – verify structure, not data."""

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import Session


@pytest.mark.asyncio
async def test_migration_007_comments_table(db_session: AsyncSession) -> None:
    """Verify migration 007 recreated comments table with new schema."""
    stmt = sa.text(
        """
        SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
        WHERE table_name = 'comments'
        ORDER BY column_name
        """
    )
    result = await db_session.execute(stmt)
    columns = {row[0]: (row[1], row[2]) for row in result}

    # Verify new columns exist
    expected_columns = {
        "id": ("NO", "character varying"),
        "artifact_id": ("NO", "character varying"),
        "number": ("NO", "integer"),
        "review_number": ("NO", "integer"),
        "title": ("NO", "character varying"),
        "description": ("NO", "text"),
        "sources": ("NO", "json"),
        "status": ("NO", "character varying"),
        "created_at": ("NO", "timestamp with time zone"),
    }

    for col, (nullable, _dtype) in expected_columns.items():
        assert col in columns, f"comments.{col} column missing"
        assert (
            columns[col][0] == nullable
        ), f"comments.{col} nullable mismatch: expected {nullable}, got {columns[col][0]}"


@pytest.mark.asyncio
async def test_migration_008_schema(db_session: AsyncSession) -> None:
    """008 adds versions, workshop questions, review flag and not_started status."""
    tables = {
        row[0]
        for row in await db_session.execute(
            sa.text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
        )
    }
    assert {"artifact_versions", "workshop_questions"} <= tables

    cols = {
        row[0]
        for row in await db_session.execute(
            sa.text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='artifacts'"
            )
        )
    }
    assert "reviewed_since_change" in cols

    check = await db_session.execute(
        sa.text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname='ck_artifacts_status'"
        )
    )
    assert "not_started" in check.scalar_one()


@pytest.mark.asyncio
async def test_migration_009_comment_columns(db_session: AsyncSession) -> None:
    """009 adds role/hypothesis/suggestion and the five-status check."""
    rows = await db_session.execute(
        sa.text(
            "SELECT column_name, is_nullable FROM information_schema.columns "
            "WHERE table_name='comments'"
        )
    )
    cols = {r[0]: r[1] for r in rows}
    assert cols["role"] == "NO"
    assert {"hypothesis", "suggestion"} <= cols.keys()

    check = await db_session.execute(
        sa.text(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='ck_comments_status'"
        )
    )
    definition = check.scalar_one()
    assert "done_manually" in definition and "rejected" in definition


@pytest.mark.asyncio
async def test_migration_013_drops_critic_comment_columns(db_session: AsyncSession) -> None:
    """013 removes the Critic leftovers category and critic_session from comments."""
    rows = await db_session.execute(
        sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='comments'")
    )
    cols = {r[0] for r in rows}

    assert "category" not in cols
    assert "critic_session" not in cols
    assert {"role", "hypothesis", "suggestion"} <= cols


@pytest.mark.asyncio
async def test_migration_014_session_per_chat(db_session: AsyncSession) -> None:
    """014 drops the per-session chat binding (its pending column is gone again, see 019)."""
    session_rows = await db_session.execute(
        sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='sessions'")
    )
    session_cols = {r[0] for r in session_rows}
    assert "chat_type" not in session_cols
    assert "reviewed_artifact" not in session_cols

    artifact_rows = await db_session.execute(
        sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='artifacts'")
    )
    artifact_cols = {r[0] for r in artifact_rows}
    assert "draft_session" not in artifact_cols
    assert "session_id" not in artifact_cols

    constraint = await db_session.execute(
        sa.text("SELECT 1 FROM pg_constraint WHERE conname='ck_sessions_chat_type'")
    )
    assert constraint.first() is None


@pytest.mark.asyncio
async def test_migration_014_session_without_chat_type(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A session needs only a project."""
    project_id = str((await client.post("/api/v1/projects", json={"name": "M"})).json()["id"])
    session = Session(id=str(uuid.uuid4()), project_id=project_id)
    db_session.add(session)
    await db_session.flush()
    await db_session.refresh(session)

    assert session.title is None
    assert session.created_at is not None


@pytest.mark.asyncio
async def test_migration_017_message_proposal_column(db_session: AsyncSession) -> None:
    """017 adds the nullable messages.proposal column."""
    rows = await db_session.execute(
        sa.text(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name='messages' AND column_name='proposal'"
        )
    )

    assert rows.scalar_one() == "YES"


@pytest.mark.asyncio
async def test_migration_019_drops_session_pending(db_session: AsyncSession) -> None:
    """019 removes sessions.pending: the chat keeps no pending action any more."""
    rows = await db_session.execute(
        sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='sessions'")
    )
    cols = {r[0] for r in rows}

    assert "pending" not in cols
    assert {"id", "project_id", "title", "created_at", "updated_at"} <= cols


@pytest.mark.asyncio
async def test_migration_020_drops_comment_reject_reason(db_session: AsyncSession) -> None:
    """020 removes the reject reason: rejecting a comment takes no reason."""
    rows = await db_session.execute(
        sa.text("SELECT column_name FROM information_schema.columns WHERE table_name='comments'")
    )

    assert "reject_reason" not in {r[0] for r in rows}
