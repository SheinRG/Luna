"""Reminders, todos, and notes CRUD (SPEC §6)."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from luna.actions import productivity
from luna.db import get_connection, rows_to_list

router = APIRouter(tags=["tasks"])


# --- Reminders -----------------------------------------------------------------

class ReminderCreate(BaseModel):
    text: str
    due_at: str | None = None  # ISO string; if absent, parsed from text


class ReminderUpdate(BaseModel):
    text: str | None = None
    due_at: str | None = None
    fired: bool | None = None


@router.get("/reminders")
async def list_reminders() -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, text, due_at, fired, created_at FROM reminders ORDER BY due_at ASC"
    ).fetchall()
    return rows_to_list(rows)


@router.post("/reminders")
async def create_reminder(req: ReminderCreate) -> dict:
    if req.due_at:
        conn = get_connection()
        cur = conn.execute(
            "INSERT INTO reminders (text, due_at) VALUES (?, ?)", (req.text, req.due_at)
        )
        conn.commit()
        return {"id": cur.lastrowid, "text": req.text, "due_at": req.due_at}
    result = productivity.create_reminder(req.text)
    return result.get("data", {})


@router.put("/reminders/{reminder_id}")
async def update_reminder(reminder_id: int, req: ReminderUpdate) -> dict:
    conn = get_connection()
    row = conn.execute("SELECT id FROM reminders WHERE id=?", (reminder_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    if req.text is not None:
        conn.execute("UPDATE reminders SET text=? WHERE id=?", (req.text, reminder_id))
    if req.due_at is not None:
        conn.execute(
            "UPDATE reminders SET due_at=?, fired=0 WHERE id=?", (req.due_at, reminder_id)
        )
    if req.fired is not None:
        conn.execute(
            "UPDATE reminders SET fired=? WHERE id=?", (int(req.fired), reminder_id)
        )
    conn.commit()
    return {"ok": True}


@router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: int) -> dict:
    conn = get_connection()
    cur = conn.execute("DELETE FROM reminders WHERE id=?", (reminder_id,))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Reminder not found")
    return {"ok": True}


# --- Todos ----------------------------------------------------------------------

class TodoCreate(BaseModel):
    item: str
    list_name: str = "default"


class TodoUpdate(BaseModel):
    item: str | None = None
    done: bool | None = None


@router.get("/todos")
async def list_todos() -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, list_name, item, done, created_at FROM todos ORDER BY done ASC, id DESC"
    ).fetchall()
    return rows_to_list(rows)


@router.post("/todos")
async def create_todo(req: TodoCreate) -> dict:
    result = productivity.create_todo(req.item, req.list_name)
    if result["status"] != "ok":
        raise HTTPException(status_code=400, detail=result["detail"])
    return result["data"]


@router.put("/todos/{todo_id}")
async def update_todo(todo_id: int, req: TodoUpdate) -> dict:
    conn = get_connection()
    row = conn.execute("SELECT id FROM todos WHERE id=?", (todo_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Todo not found")
    if req.item is not None:
        conn.execute("UPDATE todos SET item=? WHERE id=?", (req.item, todo_id))
    if req.done is not None:
        conn.execute("UPDATE todos SET done=? WHERE id=?", (int(req.done), todo_id))
    conn.commit()
    return {"ok": True}


@router.delete("/todos/{todo_id}")
async def delete_todo(todo_id: int) -> dict:
    conn = get_connection()
    cur = conn.execute("DELETE FROM todos WHERE id=?", (todo_id,))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Todo not found")
    return {"ok": True}


# --- Notes ----------------------------------------------------------------------

class NoteCreate(BaseModel):
    content: str = ""
    title: str | None = None


class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None


@router.get("/notes")
async def list_notes() -> list[dict]:
    return productivity.list_notes()


@router.get("/notes/{note_id}")
async def get_note(note_id: int) -> dict:
    conn = get_connection()
    row = conn.execute(
        "SELECT id, title, path, created_at FROM notes WHERE id=?", (note_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Note not found")
    note = dict(row)
    try:
        note["content"] = Path(note["path"]).read_text(encoding="utf-8")
    except OSError:
        note["content"] = ""
    return note


@router.post("/notes")
async def create_note(req: NoteCreate) -> dict:
    # The Tasks screen's quick-add form only collects a title (SPEC §7.1); fall
    # back to the title as the note body so a title-only note isn't rejected
    # as "empty" by the underlying action implementation.
    body = req.content.strip() or (req.title or "").strip()
    result = productivity.create_note(body, title=req.title)
    if result["status"] != "ok":
        raise HTTPException(status_code=400, detail=result["detail"])
    return result["data"]


@router.put("/notes/{note_id}")
async def update_note(note_id: int, req: NoteUpdate) -> dict:
    conn = get_connection()
    row = conn.execute("SELECT id, title, path FROM notes WHERE id=?", (note_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Note not found")
    title = req.title if req.title is not None else row["title"]
    if req.content is not None:
        try:
            Path(row["path"]).write_text(req.content, encoding="utf-8")
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Couldn't write note: {exc}")
    if req.title is not None:
        conn.execute("UPDATE notes SET title=? WHERE id=?", (title, note_id))
        conn.commit()
    return {"ok": True}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: int) -> dict:
    if not productivity.delete_note(note_id):
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}
