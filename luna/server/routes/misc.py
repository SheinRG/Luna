"""Health, upload, activity log, and delete-all-data endpoints."""

from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile

from luna.actions import documents
from luna.config import get_data_dir
from luna.core import ollama_client, voice
from luna.db import get_connection, rows_to_list, wipe_all

router = APIRouter(tags=["misc"])

_MAX_UPLOAD_BYTES = 25 * 1024 * 1024


@router.get("/health")
async def health() -> dict:
    conn = get_connection()
    row = conn.execute("SELECT value FROM settings WHERE key='model'").fetchone()
    active_model = (row["value"] if row else None) or "llama3.2:3b"
    status = await ollama_client.check_health(active_model)
    status["data_dir"] = str(get_data_dir())
    status["voice"] = "ok" if voice.is_available() else "unavailable"
    return status


@router.post("/upload")
async def upload(file: UploadFile) -> dict:
    name = Path(file.filename or "upload").name
    name = re.sub(r"[^\w.\- ]", "_", name) or "upload"
    attachment_id = uuid.uuid4().hex
    folder = get_data_dir() / "uploads" / attachment_id
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / name

    size = 0
    with dest.open("wb") as fh:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > _MAX_UPLOAD_BYTES:
                fh.close()
                shutil.rmtree(folder, ignore_errors=True)
                raise HTTPException(status_code=413, detail="File too large (25 MB max)")
            fh.write(chunk)

    kind = documents.classify_upload(name)
    result: dict = {"attachment_id": attachment_id, "name": name, "kind": kind}
    if kind in ("text", "pdf"):
        try:
            result["chars"] = len(documents.extract_text(dest))
        except ValueError:
            result["chars"] = 0
    return result


@router.get("/activity")
async def activity(limit: int = 100) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, action_id, description, status, created_at "
        "FROM activity_log ORDER BY id DESC LIMIT ?",
        (max(1, min(limit, 500)),),
    ).fetchall()
    return rows_to_list(rows)


@router.post("/data/delete-all")
async def delete_all_data() -> dict:
    """Wipe the DB and all user files; the app returns to onboarding."""
    data_dir = get_data_dir()
    wipe_all()
    for sub in ("uploads", "notes"):
        folder = data_dir / sub
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(exist_ok=True)
    (data_dir / "organize_journal.json").unlink(missing_ok=True)
    return {"ok": True}
