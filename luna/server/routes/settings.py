"""GET/PUT /api/settings (flat JSON) and GET/PUT /api/permissions."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from luna.db import get_connection

router = APIRouter(tags=["settings"])

_PERMISSION_CATEGORIES = ("apps", "files", "notifications", "voice")


@router.get("/settings")
async def get_settings() -> dict:
    conn = get_connection()
    return {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}


@router.put("/settings")
async def put_settings(updates: dict) -> dict:
    if not isinstance(updates, dict):
        raise HTTPException(status_code=400, detail="Expected a flat JSON object")
    conn = get_connection()
    for key, value in updates.items():
        if not isinstance(key, str):
            continue
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, str(value) if not isinstance(value, bool) else ("true" if value else "false")),
        )
    conn.commit()
    return {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}


@router.get("/permissions")
async def get_permissions() -> dict:
    conn = get_connection()
    return {
        r["category"]: bool(r["granted"])
        for r in conn.execute("SELECT category, granted FROM permissions")
    }


@router.put("/permissions")
async def put_permissions(updates: dict) -> dict:
    conn = get_connection()
    for category, granted in updates.items():
        if category not in _PERMISSION_CATEGORIES:
            continue
        conn.execute(
            "UPDATE permissions SET granted=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') "
            "WHERE category=?",
            (1 if granted else 0, category),
        )
    conn.commit()
    return {
        r["category"]: bool(r["granted"])
        for r in conn.execute("SELECT category, granted FROM permissions")
    }
