from fastapi import APIRouter

from app.api.v1 import artifacts, documents, projects, sessions

api_router = APIRouter()

api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
api_router.include_router(artifacts.router, prefix="/artifacts", tags=["artifacts"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
