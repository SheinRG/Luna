"""Intent router (SPEC §5): regex fast-paths first, LLM JSON fallback second.

Layer 1 costs no LLM call and is instant. Layer 2 is only reached when no
fast-path matches; it uses a compact (~150 token) prompt and a
``confidence < 0.6`` result is always downgraded to plain ``chat``. Any
malformed JSON / unreachable Ollama also falls back to ``chat`` — the router
must never raise.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from luna.config import ROUTER_CONFIDENCE_THRESHOLD
from luna.core import prompts
from luna.core.ollama_client import OllamaError, chat_once


@dataclass
class RouterResult:
    intent: str
    args: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    source: str = "regex"  # "regex" | "llm" | "llm_low_confidence" | "fallback"


def _undo_organize(m: re.Match[str]) -> dict[str, Any]:
    return {"undo": True}


def _empty_args(m: re.Match[str]) -> dict[str, Any]:
    return {}


def _group1_as(key: str) -> Callable[[re.Match[str]], dict[str, Any]]:
    def build(m: re.Match[str]) -> dict[str, Any]:
        return {key: m.group(1).strip()}

    return build


def _todo_from_add_to(m: re.Match[str]) -> dict[str, Any]:
    return {"item": m.group(1).strip()}


# Ordered most-specific-first: each entry is (compiled pattern, intent, arg builder).
_FAST_PATHS: list[tuple[re.Pattern[str], str, Callable[[re.Match[str]], dict[str, Any]]]] = [
    (
        re.compile(r"\bundo\b.{0,25}\borganiz", re.IGNORECASE),
        "organize_downloads",
        _undo_organize,
    ),
    (
        re.compile(r"\borganiz(e|ing)\b.{0,15}\bdownloads?\b", re.IGNORECASE),
        "organize_downloads",
        _empty_args,
    ),
    (
        re.compile(r"^\s*(?:take a note|add a note|note to self|note)\s*[:\-]\s*(.+)$", re.IGNORECASE),
        "create_note",
        _group1_as("text"),
    ),
    (
        re.compile(r"^\s*note\s+(.+)$", re.IGNORECASE),
        "create_note",
        _group1_as("text"),
    ),
    (
        re.compile(r"^\s*add\s+(.+?)\s+to\s+(?:my\s+)?to-?do(?:\s+list)?\s*$", re.IGNORECASE),
        "create_todo",
        _todo_from_add_to,
    ),
    (
        re.compile(r"^\s*(?:add|create)\s+(?:a\s+)?to-?do(?:\s+list)?\s*[:\-]?\s*(.+)$", re.IGNORECASE),
        "create_todo",
        _group1_as("item"),
    ),
    (
        re.compile(r"^\s*remind me\s+(?:to\s+)?(.+)$", re.IGNORECASE),
        "set_reminder",
        _group1_as("text"),
    ),
    (
        # "set/create/add/make/schedule a reminder [to|for|about] X" — also matches
        # the bare "set a reminder" (empty text), so it proposes rather than silently
        # falling through to chat.
        re.compile(
            r"^\s*(?:set|create|add|make|schedule)\s+(?:up\s+)?(?:an?\s+|the\s+)?remind(?:er)?s?\b\s*(?:to|for|about|that|:)?\s*(.*)$",
            re.IGNORECASE,
        ),
        "set_reminder",
        _group1_as("text"),
    ),
    (
        re.compile(r"^\s*(?:draft|write|compose)\s+(?:an?\s+)?email\b\s*(.*)$", re.IGNORECASE),
        "draft_email",
        lambda m: {"context": m.group(1).strip()},
    ),
    (
        re.compile(r"^\s*remember\s+(?:that\s+)?(.+)$", re.IGNORECASE),
        "remember",
        _group1_as("text"),
    ),
    (
        re.compile(r"^\s*(?:open|launch)\s+(.+)$", re.IGNORECASE),
        "open_app",
        _group1_as("app_name"),
    ),
]


# --- Local file search fast-path ---------------------------------------------------
# "find/search/look for/where is/locate X" all mean: search this computer for X.
# We strip filler and "kind" words ("the movie", "a file called") so the query is
# the meaningful term — search matches file *names*, so extra words only exclude hits.

_SEARCH_STOPWORDS = {
    "the", "a", "an", "my", "your", "our", "some", "any", "all", "that", "this",
    "these", "those", "for", "of", "to", "in", "on", "called", "named", "titled",
    "file", "files", "folder", "folders", "document", "documents", "doc", "docs",
    "movie", "movies", "film", "films", "song", "songs", "music", "photo", "photos",
    "picture", "pictures", "pic", "pics", "image", "images", "video", "videos",
    "clip", "clips",
}
# Leading words that mean the message is a question, not a file search.
_SEARCH_QUESTION_WORDS = {"what", "when", "who", "whom", "why", "how", "which", "whether"}
# If the user is clearly asking about the internet, don't pretend to disk-search it.
_WEB_HINT = re.compile(r"\b(web|online|internet|google|youtube|browser|wikipedia|imdb)\b", re.IGNORECASE)
_SEARCH_TRIGGER = re.compile(
    r"^\s*(?:find|search|look|locate|where)\b(?:\s+(?:is|are|'?s|for|up|out|me))*\s+(.+?)\s*\??$",
    re.IGNORECASE,
)


def _clean_search_query(raw: str) -> str:
    tokens = [t.strip(".,!?;:\"'") for t in raw.lower().split()]
    kept = [t for t in tokens if t and t not in _SEARCH_STOPWORDS]
    return " ".join(kept).strip() or raw.strip()


def _match_search(stripped: str) -> RouterResult | None:
    if _WEB_HINT.search(stripped):
        return None
    m = _SEARCH_TRIGGER.match(stripped)
    if m is None:
        return None
    raw = m.group(1).strip()
    first = raw.lower().split()[0] if raw.split() else ""
    if first in _SEARCH_QUESTION_WORDS:
        return None  # "find out what …", "search how to …" → conversational
    query = _clean_search_query(raw)
    if not query:
        return None
    return RouterResult(intent="search_files", args={"query": query}, confidence=1.0, source="regex")


def match_fast_path(message: str) -> RouterResult | None:
    stripped = message.strip()
    if not stripped:
        return None
    for pattern, intent, build_args in _FAST_PATHS:
        m = pattern.match(stripped) or pattern.search(stripped)
        if m:
            return RouterResult(intent=intent, args=build_args(m), confidence=1.0, source="regex")
    return _match_search(stripped)


async def classify(
    message: str, *, model: str, has_attachments: bool = False
) -> RouterResult:
    """Classify a user message into an intent. Never raises."""
    if has_attachments and re.search(
        r"\b(summar(y|ize)|what'?s in|read)\b", message, re.IGNORECASE
    ):
        return RouterResult(intent="summarize_document", args={}, confidence=1.0, source="regex")

    fast = match_fast_path(message)
    if fast is not None:
        return fast

    try:
        # temperature=0 → deterministic classification. Without it the 3B model
        # samples randomly and the SAME command routes to an action one run and
        # to plain "chat" the next, so actions fire only intermittently.
        raw = await chat_once(
            prompts.build_router_prompt(message),
            model=model,
            json_format=True,
            temperature=0.0,
        )
        data = json.loads(raw)
        intent = data.get("intent") if isinstance(data, dict) else None
        confidence = float(data.get("confidence", 0)) if isinstance(data, dict) else 0.0
        args = data.get("args") if isinstance(data, dict) and isinstance(data.get("args"), dict) else {}
    except (OllamaError, json.JSONDecodeError, TypeError, ValueError):
        return RouterResult(intent="chat", args={}, confidence=0.0, source="fallback")

    if intent not in prompts.ROUTER_INTENTS or confidence < ROUTER_CONFIDENCE_THRESHOLD:
        return RouterResult(intent="chat", args=args, confidence=confidence, source="llm_low_confidence")
    return RouterResult(intent=intent, args=args, confidence=confidence, source="llm")
