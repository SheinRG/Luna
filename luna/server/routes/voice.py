"""Voice endpoints. Failures return {"error": ...} with HTTP 200 (SPEC §9) —
the frontend hides the mic button instead of surfacing an exception."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from luna.core import voice

router = APIRouter(tags=["voice"])


class RecordRequest(BaseModel):
    action: str  # "start" | "stop"


class SpeakRequest(BaseModel):
    text: str


@router.post("/voice/record")
async def record(req: RecordRequest) -> dict:
    if req.action == "start":
        return await asyncio.to_thread(voice.start_recording)
    if req.action == "stop":
        # Transcription is CPU-bound and must finish BEFORE any LLM call —
        # the frontend sends the returned text to /api/chat afterwards.
        return await asyncio.to_thread(voice.stop_recording_and_transcribe)
    return {"error": f"Unknown action: {req.action!r} (use 'start' or 'stop')"}


@router.post("/voice/speak")
async def speak(req: SpeakRequest) -> dict:
    return await asyncio.to_thread(voice.speak, req.text)
