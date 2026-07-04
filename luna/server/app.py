"""FastAPI app factory and static mount of the frontend (SPEC §2)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from luna.db import init_db
from luna.server.routes import (
    actions,
    chat,
    conversations,
    memories,
    misc,
    settings,
    tasks,
    voice,
)

UI_DIR = Path(__file__).resolve().parent.parent / "ui"


@asynccontextmanager
async def _lifespan(app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Luna", docs_url=None, redoc_url=None, lifespan=_lifespan)

    app.include_router(chat.router, prefix="/api")
    app.include_router(actions.router, prefix="/api")
    app.include_router(conversations.router, prefix="/api")
    app.include_router(memories.router, prefix="/api")
    app.include_router(tasks.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(voice.router, prefix="/api")
    app.include_router(misc.router, prefix="/api")

    # The frontend is built by a separate agent; make sure the mount never
    # crashes if luna/ui is empty or absent at backend-dev time.
    UI_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/", StaticFiles(directory=str(UI_DIR), html=True), name="ui")
    return app
