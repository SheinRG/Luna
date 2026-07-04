"""SQLite persistence layer.

Uses the stdlib ``sqlite3`` module in WAL mode. Connections are cached
per-thread (sqlite3 connections are not safe to share across threads), which
works well for our mix of the uvicorn worker thread, the reminder-scheduler
thread, and any background asyncio tasks that happen to run on the event
loop's executor threads.
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any

from luna.config import get_data_dir

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other'
        CHECK(category IN ('preference','fact','app','style','other')),
    source TEXT NOT NULL DEFAULT 'manual'
        CHECK(source IN ('explicit','extracted','manual')),
    embedding BLOB,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
    category TEXT PRIMARY KEY CHECK(category IN ('apps','files','notifications','voice')),
    granted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    due_at TEXT NOT NULL,
    fired INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_name TEXT NOT NULL DEFAULT 'default',
    item TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
"""

_DEFAULT_SETTINGS: dict[str, str] = {
    "user_name": "",
    "assistant_name": "Luna",
    "theme": "dark",
    "font_size": "medium",
    "personality": "friendly",
    "response_length": "balanced",
    "model": "llama3.2:3b",
    "voice_enabled": "true",
    "auto_speak": "false",
    "memory_enabled": "true",
    "onboarded": "false",
}

_PERMISSION_CATEGORIES = ("apps", "files", "notifications", "voice")


def _db_path() -> Path:
    return get_data_dir() / "luna.db"


def get_connection() -> sqlite3.Connection:
    """Return a connection for the current thread, creating it if needed."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(_db_path(), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=5000")
        _local.conn = conn
    return conn


def init_db() -> None:
    """Create tables (if missing) and seed default settings/permissions."""
    conn = get_connection()
    conn.executescript(SCHEMA)
    for key, value in _DEFAULT_SETTINGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value)
        )
    for category in _PERMISSION_CATEGORIES:
        conn.execute(
            "INSERT OR IGNORE INTO permissions (category, granted) VALUES (?, 0)",
            (category,),
        )
    conn.commit()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def rows_to_list(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]


def wipe_all() -> None:
    """Delete all rows from every table but keep the schema (used by
    ``/api/data/delete-all``). Settings/permissions are reset to defaults."""
    conn = get_connection()
    tables = [
        "messages",
        "conversations",
        "memories",
        "activity_log",
        "reminders",
        "todos",
        "notes",
        "settings",
        "permissions",
    ]
    for table in tables:
        conn.execute(f"DELETE FROM {table}")
    conn.commit()
    init_db()
