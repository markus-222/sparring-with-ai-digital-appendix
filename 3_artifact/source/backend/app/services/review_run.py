"""Review run: Reviewer and Explorer in parallel, comments persisted after both."""

import asyncio
import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.commenting import CommentCheck
from app.agents.explorer import ExplorerAgent
from app.agents.reviewer import ReviewerAgent
from app.infra.llm import LLMClient
from app.models.artifact import Artifact
from app.models.comment import Comment
from app.schemas.review import BlockEditProposal, ProposedComment, ReviewComment
from app.schemas.run import Slot
from app.services.blocks import (
    BlockResolutionError,
    render_numbered,
    resolve_proposed_comment,
    split_blocks,
)
from app.services.format_check import check_format, render_report
from app.services.run_inputs import build_inputs, build_resolved_findings
from app.services.run_manager import RunContext, RunWorker
from app.services.slot_service import get_slot_artifact


class StaleDraftError(Exception):
    """The draft changed while the review was running (must not happen under the lock)."""


_BLOCK_ID_RE = re.compile(r"\bB\d+\b")


def _user_facing_text(proposed: ProposedComment) -> list[str]:
    texts = [proposed.title, proposed.explanation]
    if not isinstance(proposed.suggestion, BlockEditProposal):
        texts.append(proposed.suggestion.text)
    return texts


def make_check(slot: Slot, content: str) -> CommentCheck:
    def check(proposed: ProposedComment) -> str | None:
        if slot == "03" and not isinstance(proposed.suggestion, BlockEditProposal):
            return "in this artifact every suggestion must be a block_edit"
        try:
            resolve_proposed_comment(proposed, content)
        except BlockResolutionError as exc:
            return str(exc)
        return None

    return check


def advisory_check(proposed: ProposedComment) -> str | None:
    if any(_BLOCK_ID_RE.search(text) for text in _user_facing_text(proposed)):
        return (
            "block ids such as B3 may only appear in block_id; in title, explanation and "
            "question text quote or describe the passage instead"
        )
    return None


def merge_and_resolve(proposals: list[ProposedComment], content: str) -> list[ReviewComment]:
    seen_blocks: set[str] = set()
    comments: list[ReviewComment] = []
    for proposed in proposals:
        if isinstance(proposed.suggestion, BlockEditProposal):
            if proposed.suggestion.block_id in seen_blocks:
                continue
            seen_blocks.add(proposed.suggestion.block_id)
        comments.append(resolve_proposed_comment(proposed, content))
    return comments


async def persist_review(
    db: AsyncSession, artifact_id: str, content: str, comments: list[ReviewComment]
) -> None:
    artifact = (
        await db.execute(select(Artifact).where(Artifact.id == artifact_id).with_for_update())
    ).scalar_one()
    if artifact.content != content:
        raise StaleDraftError
    last_number, last_review = (
        await db.execute(
            select(func.max(Comment.number), func.max(Comment.review_number)).where(
                Comment.artifact_id == artifact_id
            )
        )
    ).one()
    review_number = (last_review or 0) + 1
    for offset, comment in enumerate(comments, start=1):
        db.add(
            Comment(
                artifact_id=artifact_id,
                number=(last_number or 0) + offset,
                review_number=review_number,
                title=comment.title,
                description=comment.explanation,
                sources=comment.sources,
                status="open",
                role=comment.role,
                hypothesis=comment.hypothesis,
                suggestion=comment.suggestion.model_dump(),
            )
        )
    artifact.reviewed_since_change = True
    await db.flush()


def make_review_worker(llm: LLMClient) -> RunWorker:
    async def worker(ctx: RunContext) -> None:
        await ctx.set_step("reading")
        async with ctx.session() as db:
            artifact = await get_slot_artifact(db, ctx.project_id, ctx.slot)
            artifact_id, content = artifact.id, artifact.content
            inputs = await build_inputs(db, ctx.project_id, ctx.slot, for_draft=False)
            resolved = await build_resolved_findings(db, artifact_id)
        await ctx.set_step("checking_format")
        report = render_report(
            check_format(ctx.slot, content, known_documents=inputs.known_documents)
        )
        await ctx.set_step("reviewing")
        numbered = render_numbered(split_blocks(content))
        check = make_check(ctx.slot, content)
        results = await asyncio.gather(
            ReviewerAgent(llm).propose(
                numbered_draft=numbered,
                context=inputs.text,
                resolved_findings=resolved,
                format_report=report,
                check=check,
                advisory_check=advisory_check,
            ),
            ExplorerAgent(llm).propose(
                numbered_draft=numbered,
                context=inputs.text,
                resolved_findings=resolved,
                format_report=report,
                check=check,
                advisory_check=advisory_check,
            ),
            return_exceptions=True,
        )
        proposals: list[ProposedComment] = []
        for result in results:
            if isinstance(result, BaseException):
                raise result
            proposals.extend(result)
        await ctx.set_step("preparing_comments")
        comments = merge_and_resolve(proposals, content)
        async with ctx.session() as db:
            await persist_review(db, artifact_id, content, comments)

    return worker
