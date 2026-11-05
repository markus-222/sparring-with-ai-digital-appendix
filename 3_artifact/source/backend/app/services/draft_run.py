"""Draft run: read inputs, write, format check + one fix, save in one transaction."""

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.draft import DraftAgent
from app.infra.llm import LLMClient
from app.models.comment import Comment
from app.schemas.run import Slot
from app.services.format_check import check_format, render_report
from app.services.run_inputs import build_inputs
from app.services.run_manager import RunContext, RunWorker
from app.services.slot_service import get_slot_artifact


async def store_draft(db: AsyncSession, project_id: str, slot: Slot, content: str) -> None:
    artifact = await get_slot_artifact(db, project_id, slot)
    await db.execute(
        delete(Comment).where(Comment.artifact_id == artifact.id, Comment.status == "open")
    )
    artifact.content = content
    artifact.status = "draft"
    artifact.reviewed_since_change = False
    await db.flush()


def make_draft_worker(llm: LLMClient) -> RunWorker:
    async def worker(ctx: RunContext) -> None:
        await ctx.set_step("reading")
        async with ctx.session() as db:
            existing = (await get_slot_artifact(db, ctx.project_id, ctx.slot)).content
            inputs = await build_inputs(
                db, ctx.project_id, ctx.slot, for_draft=True, existing_draft=existing
            )
        await ctx.set_step("writing")
        agent = DraftAgent(llm)
        draft = await agent.write(
            inputs=inputs.text,
            slot=ctx.slot,
            merge=bool(existing.strip()),
            language=ctx.language,
        )
        await ctx.set_step("checking_format")
        report = check_format(ctx.slot, draft, known_documents=inputs.known_documents)
        if not report.ok:
            draft = await agent.fix_format(
                inputs=inputs.text,
                slot=ctx.slot,
                draft=draft,
                report=render_report(report),
                language=ctx.language,
            )
        await ctx.set_step("saving")
        async with ctx.session() as db:
            await store_draft(db, ctx.project_id, ctx.slot, draft)

    return worker
