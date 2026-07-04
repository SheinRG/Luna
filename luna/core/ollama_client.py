"""Thin async httpx wrapper around the local Ollama HTTP API.

Every call opens a short-lived ``httpx.AsyncClient`` — simplest thing that
works for a single-user localhost app, and avoids client-lifecycle coupling
with the uvicorn thread. All Ollama-reachability failures are normalized into
:class:`OllamaError` so callers only need one except clause.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from luna.config import EMBED_MODEL, KEEP_ALIVE, NUM_CTX, OLLAMA_BASE_URL

_TIMEOUT = httpx.Timeout(connect=5.0, read=180.0, write=30.0, pool=5.0)


class OllamaError(RuntimeError):
    """Raised when Ollama is unreachable, times out, or returns an error."""


async def list_models() -> list[dict[str, Any]]:
    async with httpx.AsyncClient(base_url=OLLAMA_BASE_URL, timeout=_TIMEOUT) as client:
        resp = await client.get("/api/tags")
        resp.raise_for_status()
        return resp.json().get("models", [])


async def check_health(active_model: str) -> dict[str, Any]:
    """Used by GET /api/health — never raises, always returns a status dict."""
    try:
        models = await list_models()
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError):
        return {"ollama": "down", "models": [], "active_model": active_model}
    names = [m.get("name", "") for m in models]
    if not names:
        return {"ollama": "down", "models": [], "active_model": active_model}
    base_name = active_model.split(":")[0]
    have_model = any(n == active_model or n.startswith(f"{base_name}:") for n in names)
    status = "ok" if have_model else "model_missing"
    # {name, size} objects (size in bytes) so the frontend's model picker can
    # warn on models over ~3 GB — a bare name list can't drive that check.
    model_summaries = [
        {"name": m.get("name", ""), "size": m.get("size")} for m in models if m.get("name")
    ]
    return {"ollama": status, "models": model_summaries, "active_model": active_model}


async def chat_stream(
    messages: list[dict[str, str]],
    *,
    model: str,
    num_ctx: int = NUM_CTX,
    keep_alive: str = KEEP_ALIVE,
    json_format: bool = False,
) -> AsyncIterator[str]:
    """Yield assistant text chunks as they stream from ``/api/chat``."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
        "keep_alive": keep_alive,
        "options": {"num_ctx": num_ctx},
    }
    if json_format:
        payload["format"] = "json"
    try:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE_URL, timeout=_TIMEOUT) as client:
            async with client.stream("POST", "/api/chat", json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise OllamaError(
                        f"Ollama chat failed ({resp.status_code}): {body[:200]!r}"
                    )
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("error"):
                        raise OllamaError(str(obj["error"]))
                    text = obj.get("message", {}).get("content", "")
                    if text:
                        yield text
                    if obj.get("done"):
                        break
    except httpx.ConnectError as exc:
        raise OllamaError(f"Cannot reach Ollama at {OLLAMA_BASE_URL}") from exc
    except httpx.TimeoutException as exc:
        raise OllamaError("Ollama request timed out") from exc


async def chat_once(
    messages: list[dict[str, str]],
    *,
    model: str,
    num_ctx: int = NUM_CTX,
    keep_alive: str = KEEP_ALIVE,
    json_format: bool = False,
) -> str:
    """Non-streaming convenience wrapper for short internal calls (router
    classification, fact extraction, action-result phrasing)."""
    chunks: list[str] = []
    async for chunk in chat_stream(
        messages,
        model=model,
        num_ctx=num_ctx,
        keep_alive=keep_alive,
        json_format=json_format,
    ):
        chunks.append(chunk)
    return "".join(chunks)


async def embed(texts: str | list[str], *, model: str = EMBED_MODEL) -> list[list[float]]:
    """Return one embedding vector per input text via ``/api/embed``."""
    payload = {"model": model, "input": texts}
    try:
        async with httpx.AsyncClient(base_url=OLLAMA_BASE_URL, timeout=_TIMEOUT) as client:
            resp = await client.post("/api/embed", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.ConnectError as exc:
        raise OllamaError(f"Cannot reach Ollama at {OLLAMA_BASE_URL}") from exc
    except httpx.HTTPStatusError as exc:
        raise OllamaError(f"Embedding request failed: {exc.response.status_code}") from exc
    embeddings = data.get("embeddings")
    if not embeddings:
        raise OllamaError("Ollama returned no embeddings")
    return embeddings
