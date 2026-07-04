"""App launching via Start Menu .lnk scan with fuzzy matching (SPEC §8).

Scans both the machine-wide (ProgramData) and per-user (AppData) Start Menu
folders for ``.lnk`` shortcuts, fuzzy-matches the requested name, and opens
the best hit with ``os.startfile``. Falls back to the ``start`` shell command
for things that aren't shortcuts (e.g. ``notepad``, ``calc``).
"""

from __future__ import annotations

import difflib
import os
import subprocess
import time
from pathlib import Path
from typing import Any

_SCAN_CACHE: tuple[float, list[tuple[str, Path]]] | None = None
_SCAN_TTL_SECONDS = 300.0

_IGNORED_WORDS = {"uninstall", "readme", "help", "website", "documentation"}


def _start_menu_dirs() -> list[Path]:
    dirs: list[Path] = []
    program_data = os.environ.get("PROGRAMDATA")
    app_data = os.environ.get("APPDATA")
    if program_data:
        dirs.append(Path(program_data) / "Microsoft" / "Windows" / "Start Menu" / "Programs")
    if app_data:
        dirs.append(Path(app_data) / "Microsoft" / "Windows" / "Start Menu" / "Programs")
    return [d for d in dirs if d.is_dir()]


def scan_shortcuts() -> list[tuple[str, Path]]:
    """Return (lowercase stem, path) for every Start Menu .lnk, cached 5 min."""
    global _SCAN_CACHE
    now = time.monotonic()
    if _SCAN_CACHE is not None and now - _SCAN_CACHE[0] < _SCAN_TTL_SECONDS:
        return _SCAN_CACHE[1]
    shortcuts: list[tuple[str, Path]] = []
    for root in _start_menu_dirs():
        for path in root.rglob("*.lnk"):
            stem = path.stem.lower()
            if any(word in stem for word in _IGNORED_WORDS):
                continue
            shortcuts.append((stem, path))
    _SCAN_CACHE = (now, shortcuts)
    return shortcuts


def find_app(name: str) -> Path | None:
    """Fuzzy-match an app name against Start Menu shortcut stems."""
    query = name.strip().lower()
    if not query:
        return None
    shortcuts = scan_shortcuts()
    if not shortcuts:
        return None

    # 1. Exact stem match, 2. substring match (shortest stem wins — most specific),
    # 3. difflib closest match above a sane cutoff.
    for stem, path in shortcuts:
        if stem == query:
            return path
    substring_hits = [(stem, path) for stem, path in shortcuts if query in stem]
    if substring_hits:
        substring_hits.sort(key=lambda t: len(t[0]))
        return substring_hits[0][1]
    stems = [stem for stem, _ in shortcuts]
    close = difflib.get_close_matches(query, stems, n=1, cutoff=0.75)
    if close:
        for stem, path in shortcuts:
            if stem == close[0]:
                return path
    return None


def launch_app(name: str) -> dict[str, Any]:
    """Launch an app by name. Returns {status, detail, data?}."""
    name = name.strip().rstrip(".!?")
    if not name:
        return {"status": "error", "detail": "No app name given."}
    shortcut = find_app(name)
    if shortcut is not None:
        try:
            os.startfile(str(shortcut))  # noqa: S606 - deliberate shell open
            return {
                "status": "ok",
                "detail": f"Opened {shortcut.stem}.",
                "data": {"matched": shortcut.stem, "path": str(shortcut)},
            }
        except OSError as exc:
            return {"status": "error", "detail": f"Found {shortcut.stem} but couldn't open it: {exc}"}
    # Fallback: let the shell resolve it (notepad, calc, explorer, URLs...).
    try:
        completed = subprocess.run(
            ["cmd", "/c", "start", "", name],
            capture_output=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if completed.returncode == 0:
            return {"status": "ok", "detail": f"Started {name}.", "data": {"matched": name}}
        stderr = completed.stderr.decode(errors="replace").strip()
        return {
            "status": "error",
            "detail": f"Couldn't find an app called \"{name}\"." + (f" ({stderr})" if stderr else ""),
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "error", "detail": f"Failed to start {name}: {exc}"}


def preview_launch(name: str) -> str:
    """Human-readable preview for the action proposal card."""
    shortcut = find_app(name)
    if shortcut is not None:
        return f"Open \"{shortcut.stem}\" (Start Menu shortcut)"
    return f"Try to start \"{name}\" via the Windows shell"
