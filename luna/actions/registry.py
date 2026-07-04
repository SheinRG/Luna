"""Action metadata registry (SPEC §8).

Every executable action is declared here with its permission category and
risk profile. The chat engine consults this table to decide whether an
action needs a proposal card (permission not yet granted, or destructive)
or can run immediately (read-only + category already granted).
"""

from __future__ import annotations

from dataclasses import dataclass

from luna.db import get_connection


@dataclass(frozen=True)
class ActionSpec:
    intent: str
    label: str
    permission_category: str  # apps | files | notifications | voice
    read_only: bool
    destructive: bool  # destructive => always confirm, regardless of permission


_REGISTRY: dict[str, ActionSpec] = {
    spec.intent: spec
    for spec in [
        ActionSpec("open_app", "Open an app", "apps", read_only=False, destructive=False),
        ActionSpec("search_files", "Search your files", "files", read_only=True, destructive=False),
        ActionSpec("summarize_document", "Summarize a document", "files", read_only=True, destructive=False),
        ActionSpec("create_note", "Create a note", "files", read_only=False, destructive=False),
        ActionSpec("draft_email", "Draft an email", "files", read_only=False, destructive=False),
        ActionSpec("set_reminder", "Set a reminder", "notifications", read_only=False, destructive=False),
        ActionSpec("create_todo", "Add a to-do", "files", read_only=False, destructive=False),
        ActionSpec("organize_downloads", "Organize your Downloads folder", "files", read_only=False, destructive=True),
        ActionSpec("remember", "Remember something about you", "files", read_only=False, destructive=False),
    ]
}


def get_action_spec(intent: str) -> ActionSpec | None:
    return _REGISTRY.get(intent)


def is_permission_granted(category: str) -> bool:
    conn = get_connection()
    row = conn.execute(
        "SELECT granted FROM permissions WHERE category=?", (category,)
    ).fetchone()
    return bool(row and row["granted"])


def grant_permission(category: str) -> None:
    conn = get_connection()
    conn.execute(
        "UPDATE permissions SET granted=1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') "
        "WHERE category=?",
        (category,),
    )
    conn.commit()


def log_activity(action_id: str, description: str, status: str) -> None:
    conn = get_connection()
    conn.execute(
        "INSERT INTO activity_log (action_id, description, status) VALUES (?, ?, ?)",
        (action_id, description, status),
    )
    conn.commit()
