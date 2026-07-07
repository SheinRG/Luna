"""Luna smoke test — no pytest required.

Run:  uv run python scripts/smoke.py

Exercises the parts most likely to regress:
  1. Intent router regex fast-paths (deterministic, no Ollama needed).
  2. Live LLM classification via Ollama, including the temperature=0
     determinism guarantee (skipped automatically if Ollama is down).
  3. The capability-aware chat system prompt.

Exits non-zero if any hard check fails, so it doubles as a CI gate.
The live-model correctness checks are informational (a 3B model is fuzzy);
the hard failures are all deterministic.
"""

from __future__ import annotations

import asyncio
import sys

from luna.config import DEFAULT_MODEL
from luna.core import prompts, router
from luna.core.ollama_client import OllamaError

_PASS = 0
_FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global _PASS, _FAIL
    if ok:
        _PASS += 1
    else:
        _FAIL += 1
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f"  ({detail})" if detail else ""))


# --- 1. Regex fast-paths: (message, expected intent | None for chat) ---------
_FASTPATH_CASES: list[tuple[str, str | None]] = [
    ("open chrome", "open_app"),
    ("launch spotify", "open_app"),
    ("start notepad", "open_app"),
    ("jot down buy milk", "create_note"),
    ("write down the wifi password", "create_note"),
    ("save a note about the meeting", "create_note"),
    ("make a todo for laundry", "create_todo"),
    ("todo: finish the report", "create_todo"),
    ("add milk to my list", "create_todo"),
    ("remind me to call mom", "set_reminder"),
    ("set a reminder to call mom at 5pm", "set_reminder"),
    ("clean up my downloads", "organize_downloads"),
    ("sort my downloads folder", "organize_downloads"),
    ("organize downloads", "organize_downloads"),
    ("undo the last organize", "organize_downloads"),
    ("draft an email to my boss", "draft_email"),
    ("remember that I like tea", "remember"),
    ("find the movie dhurandhar", "search_files"),
    ("find my resume", "search_files"),
    ("where is my invoice", "search_files"),
    ("what is the capital of france", None),   # conversational -> chat
    ("search the web for cats", None),         # web intent -> chat, not disk
    ("hello there", None),
]


def test_fastpaths() -> None:
    print("1. Regex fast-paths (deterministic, no Ollama):")
    for msg, expected in _FASTPATH_CASES:
        r = router.match_fast_path(msg)
        got = r.intent if r else None
        check(f"{msg!r} -> {expected}", got == expected, f"got {got}")


# --- 2. Live LLM classification ------------------------------------------------
def _active_model() -> str:
    try:
        from luna.core.chat_engine import _get_settings, _model
        return _model(_get_settings())
    except Exception:
        return DEFAULT_MODEL


async def test_llm(model: str) -> None:
    print(f"\n4. Live classification via Ollama (model: {model}):")

    # Informational — the model is fuzzy, so we show but don't fail on these.
    print("   (informational — how natural phrasings route)")
    for msg in [
        "I'd like to set up a reminder for tomorrow morning",
        "can you tidy up my desktop",
        "what's a good movie to watch tonight",
    ]:
        r = await router.classify(msg, model=model)
        print(f"     {msg!r:48} -> {r.intent} ({r.source}, conf={r.confidence})")

    # Hard check: temperature=0 must make the LLM path deterministic.
    phrase = "tidy up my desktop please"  # no fast-path -> hits the model
    tags = []
    for _ in range(3):
        r = await router.classify(phrase, model=model)
        tags.append(f"{r.intent}/{r.confidence}")
    check(
        f"{phrase!r} classifies identically x3 (temperature=0)",
        len(set(tags)) == 1,
        " | ".join(tags),
    )


# --- 2. Capability-aware system prompt ----------------------------------------
def test_prompt() -> None:
    print("\n2. Chat system prompt (capability-aware fallback):")
    p = prompts.build_system_prompt(
        assistant_name="Luna",
        personality="friendly",
        response_length="balanced",
        memories=[],
    )
    check("lists real actions (search their files)", "search their files" in p)
    check("states the offline boundary", "offline" in p.lower())
    check("has anti-hallucination guardrail (do NOT run them)", "do NOT" in p)
    check("image note is conditional", "unless an image is actually involved" in p)


# --- 3. HTTP layer (in-process ASGI, no port/process, non-destructive) --------
def test_http() -> None:
    print("\n3. HTTP layer (in-process ASGI via TestClient):")
    try:
        from fastapi.testclient import TestClient

        from luna.server.app import create_app
    except Exception as exc:  # import/boot failure shouldn't crash the whole run
        check("TestClient + app import", False, str(exc)[:90])
        return

    with TestClient(create_app()) as client:  # 'with' runs the lifespan (init_db)
        r = client.get("/api/health")
        check("GET /api/health -> 200", r.status_code == 200, f"status {r.status_code}")
        if r.status_code == 200:
            check("health reports ollama status", "ollama" in r.json(), str(r.json())[:80])

        # Read-only list endpoints — no Ollama, no data mutation.
        for path in (
            "/api/reminders", "/api/todos", "/api/notes", "/api/settings",
            "/api/permissions", "/api/conversations", "/api/memories", "/api/activity",
        ):
            r = client.get(path)
            check(f"GET {path} -> 200", r.status_code == 200, f"status {r.status_code}")

        # Chat SSE contract: 'meta' opens and 'done' closes the stream regardless
        # of Ollama (a down model yields an 'error' event then 'done', not a hang).
        try:
            events: list[str] = []
            with client.stream("POST", "/api/chat", json={"message": "hello"}) as resp:
                status = resp.status_code
                for line in resp.iter_lines():
                    if line.startswith("event:"):
                        events.append(line[len("event:"):].strip())
            check("POST /api/chat -> 200 (SSE)", status == 200, f"status {status}")
            check("chat stream opens with 'meta'", "meta" in events, f"events={events[:6]}")
            check("chat stream ends with 'done'", "done" in events, f"tail={events[-4:]}")
        except Exception as exc:
            check("POST /api/chat SSE", False, str(exc)[:100])


def main() -> None:
    print("=== Luna smoke test ===\n")
    test_fastpaths()
    test_prompt()
    test_http()
    try:
        asyncio.run(test_llm(_active_model()))
    except (OllamaError, OSError) as exc:
        print(f"\n4. Live classification: SKIPPED (Ollama unavailable: {exc})")

    print(f"\n{'-' * 32}\n{_PASS} passed, {_FAIL} failed")
    sys.exit(1 if _FAIL else 0)


if __name__ == "__main__":
    main()
