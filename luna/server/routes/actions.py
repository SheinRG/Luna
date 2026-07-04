"""POST /api/actions/confirm — resolves a pending action proposal."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from luna.core import chat_engine

router = APIRouter(tags=["actions"])


class ConfirmRequest(BaseModel):
    action_id: str
    approved: bool
    remember_permission: bool = False


@router.post("/actions/confirm")
async def confirm(req: ConfirmRequest) -> dict:
    resolved = chat_engine.resolve_action(
        req.action_id, req.approved, req.remember_permission
    )
    return {"ok": resolved}
