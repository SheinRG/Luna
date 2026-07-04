"""POST /api/chat (SSE stream) and POST /api/chat/stop."""

from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from luna.core import chat_engine

router = APIRouter(tags=["chat"])


class ChatRequest(BaseModel):
    conversation_id: int | None = None
    message: str
    attachment_ids: list[str] = Field(default_factory=list)


class StopRequest(BaseModel):
    conversation_id: int


def _sse(event: str, payload: dict | None) -> str:
    return f"event: {event}\ndata: {json.dumps(payload or {})}\n\n"


@router.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    async def generate():
        async for name, payload in chat_engine.stream_chat(
            req.conversation_id, req.message, req.attachment_ids
        ):
            if name == "ping":
                yield ": ping\n\n"  # SSE comment — ignored by EventSource
            else:
                yield _sse(name, payload)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/stop")
async def stop(req: StopRequest) -> dict:
    chat_engine.request_stop(req.conversation_id)
    return {"ok": True}
