from fastapi import APIRouter

from app.api.v1 import (
    artifacts,
    auth,
    chat,
    comments,
    documents,
    projects,
    proposals,
    runs,
    sessions,
    workshop_questions,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
api_router.include_router(artifacts.router, prefix="/artifacts", tags=["artifacts"])
api_router.include_router(chat.router, prefix="/chat", tags=["chat"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(comments.router)
api_router.include_router(proposals.router, prefix="/sessions")
api_router.include_router(runs.router, tags=["runs"])
api_router.include_router(workshop_questions.router, tags=["workshop-questions"])
