"""Personal memory store: save/recall over nomic-embed-text embeddings.

Embeddings are stored as raw float32 numpy bytes in the ``memories.embedding``
BLOB column (SPEC §3/§4). Similarity is a plain cosine computed in Python —
the memory table stays small enough (dozens to low hundreds of rows for a
single-user desktop app) that no vector index is warranted.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from luna.config import (
    MEMORY_DEDUPE_THRESHOLD,
    MEMORY_RECALL_THRESHOLD,
    MEMORY_RECALL_TOP_K,
)
from luna.core import prompts
from luna.core.ollama_client import OllamaError, chat_once, embed
from luna.db import get_connection, rows_to_list

_VALID_CATEGORIES = {"preference", "fact", "app", "style", "other"}


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0.0:
        return 0.0
    return float(np.dot(a, b) / denom)


async def embed_text(text: str) -> list[float]:
    vectors = await embed(text)
    return vectors[0]


def list_memories() -> list[dict[str, Any]]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, text, category, source, created_at FROM memories ORDER BY created_at DESC"
    ).fetchall()
    return rows_to_list(rows)


def _all_with_embeddings() -> list[tuple[int, str, np.ndarray]]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, text, embedding FROM memories WHERE embedding IS NOT NULL"
    ).fetchall()
    out: list[tuple[int, str, np.ndarray]] = []
    for r in rows:
        try:
            out.append((r["id"], r["text"], np.frombuffer(r["embedding"], dtype=np.float32)))
        except (ValueError, TypeError):
            continue
    return out


async def recall(
    query: str,
    *,
    top_k: int = MEMORY_RECALL_TOP_K,
    threshold: float = MEMORY_RECALL_THRESHOLD,
) -> list[str]:
    """Return up to ``top_k`` memory texts with cosine similarity >= threshold."""
    candidates = _all_with_embeddings()
    if not candidates:
        return []
    try:
        query_vec = np.asarray(await embed_text(query), dtype=np.float32)
    except OllamaError:
        return []
    scored: list[tuple[float, str]] = []
    for _id, text, vec in candidates:
        if vec.shape != query_vec.shape:
            continue
        score = _cosine(query_vec, vec)
        if score >= threshold:
            scored.append((score, text))
    scored.sort(key=lambda t: t[0], reverse=True)
    return [text for _, text in scored[:top_k]]


async def _find_duplicate(vec: np.ndarray, threshold: float = MEMORY_DEDUPE_THRESHOLD) -> int | None:
    for _id, _text, existing in _all_with_embeddings():
        if existing.shape != vec.shape:
            continue
        if _cosine(vec, existing) >= threshold:
            return _id
    return None


async def save_memory(
    text: str, *, category: str = "other", source: str = "manual"
) -> dict[str, Any] | None:
    """Insert a memory unless a near-duplicate (cosine >= 0.86) already exists.

    Returns the inserted row dict, or ``None`` if skipped as a duplicate or
    embedding failed and the caller should not persist a memory with no
    vector attached... in practice we still save with a null embedding so
    manual/explicit memories aren't lost if Ollama hiccups, they just won't
    be recalled until re-embedded.
    """
    text = text.strip()
    if not text:
        return None
    if category not in _VALID_CATEGORIES:
        category = "other"
    vec: np.ndarray | None = None
    try:
        vec = np.asarray(await embed_text(text), dtype=np.float32)
    except OllamaError:
        vec = None
    if vec is not None:
        dup_id = await _find_duplicate(vec)
        if dup_id is not None:
            return None
    conn = get_connection()
    blob = vec.tobytes() if vec is not None else None
    cur = conn.execute(
        "INSERT INTO memories (text, category, source, embedding) VALUES (?, ?, ?, ?)",
        (text, category, source, blob),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id, text, category, source, created_at FROM memories WHERE id=?",
        (cur.lastrowid,),
    ).fetchone()
    return dict(row)


async def update_memory(
    memory_id: int, *, text: str | None = None, category: str | None = None
) -> bool:
    conn = get_connection()
    row = conn.execute("SELECT id FROM memories WHERE id=?", (memory_id,)).fetchone()
    if row is None:
        return False
    fields: list[str] = []
    params: list[Any] = []
    if text is not None and text.strip():
        fields.append("text=?")
        params.append(text.strip())
        try:
            vec = np.asarray(await embed_text(text.strip()), dtype=np.float32)
            fields.append("embedding=?")
            params.append(vec.tobytes())
        except OllamaError:
            pass
    if category is not None and category in _VALID_CATEGORIES:
        fields.append("category=?")
        params.append(category)
    if not fields:
        return True
    params.append(memory_id)
    conn.execute(f"UPDATE memories SET {', '.join(fields)} WHERE id=?", params)
    conn.commit()
    return True


def delete_memory(memory_id: int) -> bool:
    conn = get_connection()
    cur = conn.execute("DELETE FROM memories WHERE id=?", (memory_id,))
    conn.commit()
    return cur.rowcount > 0


def delete_all_memories() -> None:
    conn = get_connection()
    conn.execute("DELETE FROM memories")
    conn.commit()


def should_extract(user_message: str, *, was_action: bool) -> bool:
    """Cheap heuristic gate so we don't spend a 3B call on trivial exchanges
    (SPEC implementation notes): skip pure action commands and very short
    messages that are unlikely to contain durable personal info."""
    if was_action:
        return False
    return len(user_message.strip()) >= 15


async def extract_and_save_facts(
    user_message: str, assistant_message: str, *, model: str
) -> list[dict[str, Any]]:
    """One short JSON call to pull durable facts out of an exchange, dedupe,
    and persist them. Returns the list of newly saved memory rows."""
    messages = prompts.build_fact_extraction_prompt(user_message, assistant_message)
    try:
        raw = await chat_once(messages, model=model, json_format=True)
        data = json.loads(raw)
    except (OllamaError, json.JSONDecodeError, TypeError):
        return []
    facts = data.get("facts") if isinstance(data, dict) else None
    if not isinstance(facts, list):
        return []
    saved: list[dict[str, Any]] = []
    for fact in facts[:5]:
        if not isinstance(fact, dict):
            continue
        text = str(fact.get("text", "")).strip()
        # Guard against 3B-model noise: a durable fact is a sentence, not a
        # fragment like "Hello".
        if len(text) < 12 or " " not in text:
            continue
        category = fact.get("category") if fact.get("category") in _VALID_CATEGORIES else "other"
        result = await save_memory(text, category=category, source="extracted")
        if result:
            saved.append(result)
    return saved
