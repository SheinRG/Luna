"""Runtime configuration: data directory, model defaults, and tunables.

The data directory defaults to ``%LOCALAPPDATA%/Luna`` on Windows. It can be
overridden with the ``LUNA_DATA_DIR`` environment variable, which is used for
local development and automated testing so runs never touch the real user
profile.
"""

from __future__ import annotations

import os
from pathlib import Path


def _default_data_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "Luna"
    # Non-Windows dev fallback (should not happen on the target machine).
    return Path.home() / ".luna"


def get_data_dir() -> Path:
    """Return the data directory, creating it (and subfolders) if needed."""
    override = os.environ.get("LUNA_DATA_DIR")
    data_dir = Path(override) if override else _default_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "uploads").mkdir(exist_ok=True)
    (data_dir / "notes").mkdir(exist_ok=True)
    (data_dir / "whisper_models").mkdir(exist_ok=True)
    return data_dir


# --- Ollama / model constants (SPEC §0) -------------------------------------
OLLAMA_BASE_URL = os.environ.get("LUNA_OLLAMA_URL", "http://127.0.0.1:11434")
DEFAULT_MODEL = "llama3.2:3b"
EMBED_MODEL = "nomic-embed-text"
NUM_CTX = 4096
KEEP_ALIVE = "15m"

# --- Memory tunables (SPEC §4) ----------------------------------------------
MEMORY_RECALL_TOP_K = 4
MEMORY_RECALL_THRESHOLD = 0.55
MEMORY_DEDUPE_THRESHOLD = 0.86

# --- Router tunables (SPEC §5) ----------------------------------------------
ROUTER_CONFIDENCE_THRESHOLD = 0.6

# --- Action confirmation tunables (SPEC §6) ---------------------------------
ACTION_CONFIRM_TIMEOUT_SECONDS = 120

# --- Voice tunables (SPEC §9) ------------------------------------------------
VOICE_SAMPLE_RATE = 16_000
WHISPER_MODEL_SIZE = "tiny.en"
WHISPER_IDLE_UNLOAD_SECONDS = 5 * 60

# --- Reminder scheduler ------------------------------------------------------
REMINDER_POLL_SECONDS = 30

APP_NAME = "Luna"
