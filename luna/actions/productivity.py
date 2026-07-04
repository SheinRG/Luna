"""Productivity actions: notes (.md files), reminders, todos, email drafts.

Reminder due-times are parsed from natural language with a small regex
grammar ("in 10 minutes", "at 5pm", "tomorrow at 9:30", "on friday") — good
enough for a demo without dragging in a date-parsing dependency.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from luna.config import get_data_dir
from luna.core.ollama_client import OllamaError, chat_once
from luna.db import get_connection

# --- Notes --------------------------------------------------------------------

def _safe_filename(title: str) -> str:
    cleaned = re.sub(r"[^\w\- ]", "", title).strip().replace(" ", "-")[:60]
    return cleaned or "note"


def create_note(text: str, *, title: str | None = None) -> dict[str, Any]:
    text = text.strip()
    if not text:
        return {"status": "error", "detail": "The note is empty."}
    if not title:
        title = text.splitlines()[0][:50]
    notes_dir = get_data_dir() / "notes"
    notes_dir.mkdir(exist_ok=True)
    base = _safe_filename(title)
    path = notes_dir / f"{base}.md"
    counter = 1
    while path.exists():
        path = notes_dir / f"{base}-{counter}.md"
        counter += 1
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    path.write_text(f"# {title}\n\n_{stamp}_\n\n{text}\n", encoding="utf-8")
    conn = get_connection()
    cur = conn.execute("INSERT INTO notes (title, path) VALUES (?, ?)", (title, str(path)))
    conn.commit()
    return {
        "status": "ok",
        "detail": f"Saved note \"{title}\".",
        "data": {"id": cur.lastrowid, "title": title, "path": str(path)},
    }


def list_notes() -> list[dict[str, Any]]:
    conn = get_connection()
    rows = conn.execute("SELECT id, title, path, created_at FROM notes ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def delete_note(note_id: int) -> bool:
    conn = get_connection()
    row = conn.execute("SELECT path FROM notes WHERE id=?", (note_id,)).fetchone()
    if row is None:
        return False
    Path(row["path"]).unlink(missing_ok=True)
    conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    conn.commit()
    return True


# --- Reminders ------------------------------------------------------------------

_WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}

_REL_UNITS = {
    "second": 1, "sec": 1, "s": 1,
    "minute": 60, "min": 60, "m": 60,
    "hour": 3600, "hr": 3600, "h": 3600,
    "day": 86400, "d": 86400,
    "week": 604800, "w": 604800,
}


def _parse_clock(text: str) -> tuple[int, int] | None:
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", text, re.IGNORECASE)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    meridiem = (m.group(3) or "").lower()
    if meridiem == "pm" and hour < 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0
    elif not meridiem and hour <= 7:
        hour += 12  # bare "at 5" almost always means 5 PM
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def parse_due_time(text: str, *, now: datetime | None = None) -> tuple[datetime | None, str]:
    """Extract a due datetime from reminder text.

    Returns (due_at or None, text with the time phrase stripped).
    """
    now = now or datetime.now()
    working = text.strip()

    # "in 10 minutes" / "in 2 hours" / "in an hour"
    m = re.search(
        r"\bin\s+(\d+|an?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?)\b",
        working, re.IGNORECASE,
    )
    if m:
        qty = 1 if m.group(1).lower() in ("a", "an") else int(m.group(1))
        unit = m.group(2).lower().rstrip("s")
        seconds = _REL_UNITS.get(unit, _REL_UNITS.get(unit[:3], 60))
        due = now + timedelta(seconds=qty * seconds)
        return due, (working[: m.start()] + working[m.end():]).strip(" ,.")

    # "tomorrow [at 9[:30] [am|pm]]"
    m = re.search(r"\btomorrow\b(?:\s+at\s+([\w: ]+?))?(?=$|[,.])", working, re.IGNORECASE)
    if m:
        clock = _parse_clock(m.group(1)) if m.group(1) else (9, 0)
        clock = clock or (9, 0)
        due = (now + timedelta(days=1)).replace(hour=clock[0], minute=clock[1], second=0, microsecond=0)
        return due, (working[: m.start()] + working[m.end():]).strip(" ,.")

    # "on friday [at 3pm]" / bare weekday
    m = re.search(
        r"\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b"
        r"(?:\s+at\s+([\w: ]+?))?(?=$|[,.])",
        working, re.IGNORECASE,
    )
    if m:
        target = _WEEKDAYS[m.group(1).lower()]
        days_ahead = (target - now.weekday()) % 7 or 7
        clock = _parse_clock(m.group(2)) if m.group(2) else (9, 0)
        clock = clock or (9, 0)
        due = (now + timedelta(days=days_ahead)).replace(
            hour=clock[0], minute=clock[1], second=0, microsecond=0
        )
        return due, (working[: m.start()] + working[m.end():]).strip(" ,.")

    # "at 5pm" / "at 17:30" (today, or tomorrow if already past)
    m = re.search(r"\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b", working, re.IGNORECASE)
    if m:
        clock = _parse_clock(m.group(1))
        if clock:
            due = now.replace(hour=clock[0], minute=clock[1], second=0, microsecond=0)
            if due <= now:
                due += timedelta(days=1)
            return due, (working[: m.start()] + working[m.end():]).strip(" ,.")

    return None, working


def create_reminder(text: str, due_at: datetime | None = None) -> dict[str, Any]:
    parsed_due, remainder = (due_at, text) if due_at else parse_due_time(text)
    if parsed_due is None:
        # Default: 1 hour from now — visible in the response so the user can adjust.
        parsed_due = datetime.now() + timedelta(hours=1)
        remainder = text
    reminder_text = remainder.strip() or text.strip()
    conn = get_connection()
    cur = conn.execute(
        "INSERT INTO reminders (text, due_at) VALUES (?, ?)",
        (reminder_text, parsed_due.strftime("%Y-%m-%dT%H:%M:%S")),
    )
    conn.commit()
    nice_time = parsed_due.strftime("%a %d %b, %I:%M %p").replace(" 0", " ")
    return {
        "status": "ok",
        "detail": f"Reminder set for {nice_time}: {reminder_text}",
        "data": {"id": cur.lastrowid, "text": reminder_text, "due_at": parsed_due.isoformat()},
    }


# --- Todos ---------------------------------------------------------------------

def create_todo(item: str, list_name: str = "default") -> dict[str, Any]:
    item = item.strip()
    if not item:
        return {"status": "error", "detail": "Empty to-do item."}
    conn = get_connection()
    cur = conn.execute(
        "INSERT INTO todos (list_name, item) VALUES (?, ?)", (list_name, item)
    )
    conn.commit()
    return {
        "status": "ok",
        "detail": f"Added to your to-do list: {item}",
        "data": {"id": cur.lastrowid, "item": item, "list_name": list_name},
    }


# --- Email drafts ----------------------------------------------------------------

async def draft_email(context: str, *, model: str) -> dict[str, Any]:
    """Draft an email with one LLM call and save it as a note."""
    context = context.strip() or "a short, polite email"
    try:
        draft = await chat_once(
            [
                {
                    "role": "system",
                    "content": "Write a complete, ready-to-send email (Subject line first, then body). Professional but warm. No preamble or explanation — output only the email.",
                },
                {"role": "user", "content": f"Draft an email: {context}"},
            ],
            model=model,
        )
    except OllamaError as exc:
        return {"status": "error", "detail": f"Couldn't draft the email: {exc}"}
    subject_match = re.search(r"^subject\s*:\s*(.+)$", draft, re.IGNORECASE | re.MULTILINE)
    title = f"Email draft — {subject_match.group(1).strip()[:40]}" if subject_match else "Email draft"
    note = create_note(draft.strip(), title=title)
    return {
        "status": "ok",
        "detail": draft.strip(),
        "data": {"saved_as_note": note.get("data", {}).get("path")},
    }
