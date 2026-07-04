"""File search and Downloads organization (SPEC §8).

Search: ``os.scandir`` walk of Desktop/Documents/Downloads, depth <= 4,
skips hidden/node_modules/venv dirs, caps at 200 hits, returns top 20 ranked
by name-match quality + modification time.

Organize Downloads: two-phase — ``plan_organize()`` builds a preview mapping
(file -> category subfolder) shown on the proposal card; ``execute_organize()``
performs the moves only after explicit confirmation and journals them to
``organize_journal.json`` in the data dir so "undo last organize" can restore
everything.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

from luna.config import get_data_dir

_SKIP_DIRS = {"node_modules", ".git", "__pycache__", "venv", ".venv", "env", ".env"}
_MAX_HITS = 200
_TOP_N = 20
_MAX_DEPTH = 4

CATEGORY_MAP: dict[str, str] = {
    # Images
    ".jpg": "Images", ".jpeg": "Images", ".png": "Images", ".gif": "Images",
    ".webp": "Images", ".bmp": "Images", ".svg": "Images", ".heic": "Images",
    # Docs
    ".pdf": "Docs", ".doc": "Docs", ".docx": "Docs", ".xls": "Docs",
    ".xlsx": "Docs", ".ppt": "Docs", ".pptx": "Docs", ".txt": "Docs",
    ".md": "Docs", ".csv": "Docs", ".odt": "Docs", ".rtf": "Docs",
    # Archives
    ".zip": "Archives", ".rar": "Archives", ".7z": "Archives",
    ".tar": "Archives", ".gz": "Archives",
    # Installers
    ".exe": "Installers", ".msi": "Installers", ".msix": "Installers",
    # Media
    ".mp3": "Media", ".wav": "Media", ".flac": "Media", ".m4a": "Media",
    ".mp4": "Media", ".mkv": "Media", ".avi": "Media", ".mov": "Media",
    ".webm": "Media",
}
ORGANIZE_FOLDERS = ("Images", "Docs", "Archives", "Installers", "Media", "Other")


def _home() -> Path:
    return Path.home()


def _search_roots() -> list[Path]:
    home = _home()
    return [p for p in (home / "Desktop", home / "Documents", home / "Downloads") if p.is_dir()]


def _walk(root: Path, depth: int, hits: list[Path], query_terms: list[str]) -> None:
    if depth > _MAX_DEPTH or len(hits) >= _MAX_HITS:
        return
    try:
        with os.scandir(root) as entries:
            for entry in entries:
                if len(hits) >= _MAX_HITS:
                    return
                name = entry.name
                if name.startswith("."):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if name.lower() in _SKIP_DIRS:
                        continue
                    _walk(Path(entry.path), depth + 1, hits, query_terms)
                elif entry.is_file(follow_symlinks=False):
                    lowered = name.lower()
                    if all(term in lowered for term in query_terms):
                        hits.append(Path(entry.path))
    except (PermissionError, OSError):
        return


def _score(path: Path, query: str) -> float:
    name = path.name.lower()
    q = query.lower()
    score = 0.0
    if name == q:
        score += 100.0
    elif name.startswith(q):
        score += 50.0
    elif q in name:
        score += 25.0
    try:
        age_days = max(0.0, (time.time() - path.stat().st_mtime) / 86_400)
        score += max(0.0, 20.0 - age_days / 30.0)  # gentle recency boost
    except OSError:
        pass
    return score


def search_files(query: str) -> dict[str, Any]:
    """Search user folders for files whose names contain all query terms."""
    query = query.strip()
    if not query:
        return {"status": "error", "detail": "Empty search query."}
    terms = [t.lower() for t in query.split() if t]
    hits: list[Path] = []
    for root in _search_roots():
        _walk(root, 0, hits, terms)
    ranked = sorted(hits, key=lambda p: _score(p, query), reverse=True)[:_TOP_N]
    results = []
    for p in ranked:
        try:
            stat = p.stat()
            results.append(
                {
                    "name": p.name,
                    "path": str(p),
                    "size": stat.st_size,
                    "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(stat.st_mtime)),
                }
            )
        except OSError:
            continue
    detail = (
        f"Found {len(results)} file(s) matching \"{query}\"."
        if results
        else f"No files matching \"{query}\" in Desktop, Documents, or Downloads."
    )
    return {"status": "ok", "detail": detail, "data": {"results": results, "query": query}}


# --- Organize Downloads -------------------------------------------------------

def _downloads_dir() -> Path:
    return _home() / "Downloads"


def _journal_path() -> Path:
    return get_data_dir() / "organize_journal.json"


def plan_organize() -> dict[str, Any]:
    """Scan Downloads (top level only) and build the move plan."""
    downloads = _downloads_dir()
    if not downloads.is_dir():
        return {"status": "error", "detail": "Downloads folder not found."}
    plan: list[dict[str, str]] = []
    try:
        with os.scandir(downloads) as entries:
            for entry in entries:
                if not entry.is_file(follow_symlinks=False) or entry.name.startswith("."):
                    continue
                # Skip in-progress downloads.
                if entry.name.lower().endswith((".crdownload", ".part", ".tmp")):
                    continue
                ext = Path(entry.name).suffix.lower()
                category = CATEGORY_MAP.get(ext, "Other")
                plan.append({"file": entry.name, "target": category})
    except OSError as exc:
        return {"status": "error", "detail": f"Couldn't scan Downloads: {exc}"}
    counts: dict[str, int] = {}
    for item in plan:
        counts[item["target"]] = counts.get(item["target"], 0) + 1
    return {
        "status": "ok",
        "detail": f"{len(plan)} file(s) to organize into {len(counts)} folder(s).",
        "data": {"plan": plan, "counts": counts, "root": str(downloads)},
    }


def execute_organize(plan: list[dict[str, str]]) -> dict[str, Any]:
    """Move files per the confirmed plan, journaling each move for undo."""
    downloads = _downloads_dir()
    moves: list[dict[str, str]] = []
    errors: list[str] = []
    for item in plan:
        src = downloads / item["file"]
        if not src.is_file():
            continue  # vanished since planning; skip silently
        target_dir = downloads / item["target"]
        target_dir.mkdir(exist_ok=True)
        dest = target_dir / src.name
        # Never overwrite: add a numeric suffix on collision.
        counter = 1
        while dest.exists():
            dest = target_dir / f"{src.stem} ({counter}){src.suffix}"
            counter += 1
        try:
            shutil.move(str(src), str(dest))
            moves.append({"from": str(src), "to": str(dest)})
        except (OSError, shutil.Error) as exc:
            errors.append(f"{src.name}: {exc}")
    if moves:
        _journal_path().write_text(
            json.dumps({"timestamp": time.time(), "moves": moves}, indent=2),
            encoding="utf-8",
        )
    detail = f"Moved {len(moves)} file(s)."
    if errors:
        detail += f" {len(errors)} failed: {'; '.join(errors[:3])}"
    return {
        "status": "ok" if moves or not errors else "error",
        "detail": detail,
        "data": {"moved": len(moves), "errors": errors},
    }


def undo_last_organize() -> dict[str, Any]:
    """Restore files from the most recent organize journal."""
    journal = _journal_path()
    if not journal.is_file():
        return {"status": "error", "detail": "Nothing to undo — no organize has been run."}
    try:
        entry = json.loads(journal.read_text(encoding="utf-8"))
        moves = entry.get("moves", [])
    except (json.JSONDecodeError, OSError) as exc:
        return {"status": "error", "detail": f"Couldn't read the undo journal: {exc}"}
    restored = 0
    errors: list[str] = []
    for move in reversed(moves):
        src, dest = Path(move["to"]), Path(move["from"])
        if not src.is_file():
            errors.append(f"{src.name}: no longer at organized location")
            continue
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                errors.append(f"{dest.name}: a file already exists at the original spot")
                continue
            shutil.move(str(src), str(dest))
            restored += 1
        except (OSError, shutil.Error) as exc:
            errors.append(f"{src.name}: {exc}")
    journal.unlink(missing_ok=True)
    # Clean up now-empty category folders.
    downloads = _downloads_dir()
    for folder in ORGANIZE_FOLDERS:
        d = downloads / folder
        try:
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        except OSError:
            pass
    detail = f"Restored {restored} file(s) to Downloads."
    if errors:
        detail += f" {len(errors)} couldn't be restored."
    return {"status": "ok", "detail": detail, "data": {"restored": restored, "errors": errors}}
