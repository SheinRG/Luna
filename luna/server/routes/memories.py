"""Memory review endpoints: list, add, edit, delete (single or all)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from luna.core import memory

router = APIRouter(tags=["memories"])


class MemoryCreate(BaseModel):
    text: str
    category: str = "other"


class MemoryUpdate(BaseModel):
    text: str | None = None
    category: str | None = None


@router.get("/memories")
async def list_memories() -> list[dict]:
    return memory.list_memories()


@router.post("/memories")
async def create_memory(req: MemoryCreate) -> dict:
    saved = await memory.save_memory(req.text, category=req.category, source="manual")
    if saved is None:
        raise HTTPException(status_code=409, detail="Duplicate or empty memory")
    return saved


@router.put("/memories/{memory_id}")
async def update_memory(memory_id: int, req: MemoryUpdate) -> dict:
    ok = await memory.update_memory(memory_id, text=req.text, category=req.category)
    if not ok:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"ok": True}


@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: int) -> dict:
    if not memory.delete_memory(memory_id):
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"ok": True}


@router.delete("/memories")
async def delete_all_memories() -> dict:
    memory.delete_all_memories()
    return {"ok": True}
