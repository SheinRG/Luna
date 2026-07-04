"""Conversation and message history endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from luna.db import get_connection, rows_to_list

router = APIRouter(tags=["conversations"])


class ConversationCreate(BaseModel):
    title: str = "New chat"


@router.get("/conversations")
async def list_conversations() -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
    ).fetchall()
    return rows_to_list(rows)


@router.post("/conversations")
async def create_conversation(req: ConversationCreate) -> dict:
    conn = get_connection()
    cur = conn.execute("INSERT INTO conversations (title) VALUES (?)", (req.title,))
    conn.commit()
    row = conn.execute(
        "SELECT id, title, created_at, updated_at FROM conversations WHERE id=?",
        (cur.lastrowid,),
    ).fetchone()
    return dict(row)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: int) -> dict:
    conn = get_connection()
    cur = conn.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(conversation_id: int) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, conversation_id, role, content, attachments_json, created_at "
        "FROM messages WHERE conversation_id=? ORDER BY id ASC",
        (conversation_id,),
    ).fetchall()
    messages = rows_to_list(rows)
    for m in messages:
        try:
            m["attachments"] = json.loads(m.pop("attachments_json") or "[]")
        except json.JSONDecodeError:
            m["attachments"] = []
    return messages
