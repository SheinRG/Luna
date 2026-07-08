"""Chat engine: orchestrates recall → router → (action | chat) → SSE events.

The public entry point is :func:`stream_chat`, an async generator yielding
``(event_name, payload)`` tuples that the route layer formats as SSE. The
action-confirmation flow keeps the stream open while waiting on the user:
proposals are parked in a module-level registry keyed by ``action_id`` and
resolved by ``POST /api/actions/confirm`` (120 s timeout → auto-deny). While
parked, the generator emits periodic ``ping`` comments so the connection
stays warm.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from luna.config import ACTION_CONFIRM_TIMEOUT_SECONDS, DEFAULT_MODEL
from luna.actions import apps, documents, files, productivity, system
from luna.actions.registry import (
    get_action_spec,
    grant_permission,
    is_permission_granted,
    log_activity,
)
from luna.core import memory, prompts, router
from luna.core.ollama_client import OllamaError, chat_stream
from luna.db import get_connection

Event = tuple[str, dict[str, Any] | None]

_HISTORY_LIMIT = 12
_ATTACHMENT_TEXT_CAP = 8_000


# --- Pending action-confirmation registry -------------------------------------

@dataclass
class _PendingAction:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    approved: bool = False
    remember_permission: bool = False


_pending_actions: dict[str, _PendingAction] = {}
_stop_flags: set[int] = set()


def resolve_action(action_id: str, approved: bool, remember_permission: bool = False) -> bool:
    """Called by POST /api/actions/confirm. Returns False for unknown ids."""
    pending = _pending_actions.get(action_id)
    if pending is None:
        return False
    pending.approved = approved
    pending.remember_permission = remember_permission
    pending.event.set()
    return True


def request_stop(conversation_id: int) -> None:
    """Called by POST /api/chat/stop — the token loop checks this flag."""
    _stop_flags.add(conversation_id)


# --- Settings helpers ------------------------------------------------------------

def _get_settings() -> dict[str, str]:
    conn = get_connection()
    return {r["key"]: r["value"] or "" for r in conn.execute("SELECT key, value FROM settings")}


def _model(settings: dict[str, str]) -> str:
    model = settings.get("model") or DEFAULT_MODEL
    # Embedding models (e.g. nomic-embed-text) can't do chat. If one was somehow
    # selected, fall back to the default rather than failing every reply.
    if "embed" in model.lower():
        return DEFAULT_MODEL
    return model


# --- Persistence helpers ----------------------------------------------------------

def _ensure_conversation(conversation_id: int | None, first_message: str) -> int:
    conn = get_connection()
    if conversation_id is not None:
        row = conn.execute(
            "SELECT id FROM conversations WHERE id=?", (conversation_id,)
        ).fetchone()
        if row is not None:
            return conversation_id
    title = first_message.strip().replace("\n", " ")[:48] or "New chat"
    cur = conn.execute("INSERT INTO conversations (title) VALUES (?)", (title,))
    conn.commit()
    return int(cur.lastrowid)


def _persist_message(
    conversation_id: int, role: str, content: str, attachments: list[dict[str, Any]] | None = None
) -> int:
    conn = get_connection()
    cur = conn.execute(
        "INSERT INTO messages (conversation_id, role, content, attachments_json) VALUES (?, ?, ?, ?)",
        (conversation_id, role, content, json.dumps(attachments or [])),
    )
    conn.execute(
        "UPDATE conversations SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        (conversation_id,),
    )
    conn.commit()
    return int(cur.lastrowid)


def _history(conversation_id: int, limit: int = _HISTORY_LIMIT) -> list[dict[str, str]]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?",
        (conversation_id, limit),
    ).fetchall()
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]


# --- Attachment context -----------------------------------------------------------

def _attachment_context(attachment_ids: list[str]) -> tuple[str, list[dict[str, Any]]]:
    """Build LLM-visible context for attachments + metadata for persistence."""
    context_parts: list[str] = []
    meta: list[dict[str, Any]] = []
    for att_id in attachment_ids:
        path = documents.find_attachment(att_id)
        if path is None:
            continue
        kind = documents.classify_upload(path.name)
        meta.append({"attachment_id": att_id, "name": path.name, "kind": kind})
        if kind == "image":
            context_parts.append(
                f"[The user attached an image file named \"{path.name}\". You run a text-only "
                "model and cannot see it — say so honestly and offer to help another way.]"
            )
        else:
            try:
                text = documents.extract_text(path)[:_ATTACHMENT_TEXT_CAP]
                context_parts.append(f"[Attached file \"{path.name}\" contents:]\n{text}")
            except ValueError:
                context_parts.append(f"[Attached file \"{path.name}\" could not be read.]")
    return "\n\n".join(context_parts), meta


# --- Action preview + execution -----------------------------------------------------

def _build_preview(intent: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Return (preview text, possibly-enriched args) for a proposal card."""
    if intent == "open_app":
        return apps.preview_launch(str(args.get("app_name", ""))), args
    if intent == "search_files":
        return f"Search Desktop, Documents and Downloads for \"{args.get('query', '')}\"", args
    if intent == "organize_downloads":
        if args.get("undo"):
            return "Undo the last Downloads organization (restore files to their original spots)", args
        plan_result = files.plan_organize()
        if plan_result["status"] == "ok":
            plan = plan_result["data"]["plan"]
            counts = plan_result["data"]["counts"]
            summary = ", ".join(f"{count} → {folder}/" for folder, count in sorted(counts.items()))
            lines = [f"{item['file']}  →  {item['target']}/" for item in plan[:15]]
            more = f"\n… and {len(plan) - 15} more" if len(plan) > 15 else ""
            preview = f"Move {len(plan)} file(s): {summary}\n\n" + "\n".join(lines) + more
            args = {**args, "plan": plan}
        else:
            preview = plan_result["detail"]
        return preview, args
    if intent == "set_reminder":
        due, remainder = productivity.parse_due_time(str(args.get("text", "")))
        when = due.strftime("%a %d %b, %I:%M %p") if due else "1 hour from now (no time given)"
        return f"Remind you: \"{remainder}\" — {when}", args
    if intent == "create_note":
        text = str(args.get("text", ""))
        return f"Save a note: \"{text[:80]}{'…' if len(text) > 80 else ''}\"", args
    if intent == "create_todo":
        return f"Add to your to-do list: \"{args.get('item', '')}\"", args
    if intent == "draft_email":
        return f"Draft an email ({args.get('context') or 'no details given'}) and save it to your notes", args
    if intent == "summarize_document":
        return "Read the attached document and summarize it", args
    if intent == "remember":
        return f"Remember: \"{args.get('text', '')}\"", args
    if intent in ("system_control", "system_power"):
        return system.preview(str(args.get("command", ""))), args
    return "Run this action", args


async def _execute_action(
    intent: str, args: dict[str, Any], attachment_ids: list[str], model: str
) -> dict[str, Any]:
    """Dispatch to the concrete action implementation."""
    if intent == "open_app":
        return apps.launch_app(str(args.get("app_name", "")))
    if intent == "search_files":
        return files.search_files(str(args.get("query", "")))
    if intent == "organize_downloads":
        if args.get("undo"):
            return files.undo_last_organize()
        plan = args.get("plan")
        if not plan:
            plan_result = files.plan_organize()
            if plan_result["status"] != "ok":
                return plan_result
            plan = plan_result["data"]["plan"]
        return files.execute_organize(plan)
    if intent == "set_reminder":
        return productivity.create_reminder(str(args.get("text", "")))
    if intent == "create_note":
        return productivity.create_note(str(args.get("text", "")))
    if intent == "create_todo":
        return productivity.create_todo(str(args.get("item", "")))
    if intent == "draft_email":
        return await productivity.draft_email(str(args.get("context", "")), model=model)
    if intent == "summarize_document":
        if not attachment_ids:
            return {"status": "error", "detail": "No document attached — upload a file first."}
        return await documents.summarize_document(attachment_ids[-1], model=model)
    if intent in ("system_control", "system_power"):
        return system.run(str(args.get("command", "")))
    return {"status": "error", "detail": f"Unknown action: {intent}"}


# --- Main entry ---------------------------------------------------------------------

async def stream_chat(
    conversation_id: int | None,
    message: str,
    attachment_ids: list[str],
) -> AsyncIterator[Event]:
    """Yield SSE events for one user message. Never raises — errors become
    ``error`` events followed by ``done``."""
    settings = _get_settings()
    model = _model(settings)
    assistant_name = settings.get("assistant_name") or "Luna"
    personality = settings.get("personality") or "friendly"
    response_length = settings.get("response_length") or "balanced"
    memory_enabled = settings.get("memory_enabled", "true") == "true"

    attachment_context, attachment_meta = _attachment_context(attachment_ids)

    conv_id = _ensure_conversation(conversation_id, message)
    _stop_flags.discard(conv_id)
    history = _history(conv_id)
    user_message_id = _persist_message(conv_id, "user", message, attachment_meta)
    yield ("meta", {"conversation_id": conv_id, "message_id": user_message_id})

    assistant_text_parts: list[str] = []
    was_action = False

    try:
        # 1. Memory recall.
        recalled: list[str] = []
        if memory_enabled:
            try:
                recalled = await memory.recall(message)
            except Exception:
                recalled = []

        # 2. Route.
        route = await router.classify(
            message, model=model, has_attachments=bool(attachment_ids)
        )

        if route.intent == "chat":
            # 3. Plain streamed chat.
            system_prompt = prompts.build_system_prompt(
                assistant_name=assistant_name,
                personality=personality,
                response_length=response_length,
                memories=recalled,
            )
            user_content = message
            if attachment_context:
                user_content = f"{attachment_context}\n\n{message}"
            llm_messages = (
                [{"role": "system", "content": system_prompt}]
                + history
                + [{"role": "user", "content": user_content}]
            )
            async for event in _stream_llm(llm_messages, model, conv_id, assistant_text_parts):
                yield event
        elif route.intent == "remember":
            # Explicit memory save — no permission card; governed by the
            # memory_enabled setting and the Memory review screen.
            was_action = True
            text = str(route.args.get("text", "")).strip() or message
            saved = await memory.save_memory(text, category="fact", source="explicit")
            if saved:
                yield ("memory_saved", {"id": saved["id"], "text": saved["text"]})
                reply = "Got it — I'll remember that."
            else:
                reply = "I already have that noted."
            log_activity("remember", f"Remember: {text[:80]}", "ok")
            assistant_text_parts.append(reply)
            yield ("token", {"text": reply})
        else:
            # 4. Action flow.
            was_action = True
            async for event in _run_action_flow(
                route, conv_id, attachment_ids, model, settings, assistant_text_parts
            ):
                yield event
    except OllamaError as exc:
        yield ("error", {"message": str(exc)})
    except Exception as exc:  # never leak a traceback into the stream
        yield ("error", {"message": f"Unexpected error: {exc}"})
    finally:
        assistant_text = "".join(assistant_text_parts).strip()
        assistant_message_id = None
        if assistant_text:
            assistant_message_id = _persist_message(conv_id, "assistant", assistant_text)
        _stop_flags.discard(conv_id)
        yield ("done", {"message_id": assistant_message_id})

        # 5. Post-response fact extraction, fire-and-forget (SPEC §4 step 5).
        if (
            memory_enabled
            and assistant_text
            and memory.should_extract(message, was_action=was_action)
        ):
            asyncio.create_task(
                memory.extract_and_save_facts(message, assistant_text, model=model)
            )


async def _stream_llm(
    llm_messages: list[dict[str, str]],
    model: str,
    conv_id: int,
    sink: list[str],
) -> AsyncIterator[Event]:
    """Stream LLM tokens, honouring the per-conversation stop flag."""
    async for chunk in chat_stream(llm_messages, model=model):
        if conv_id in _stop_flags:
            break
        sink.append(chunk)
        yield ("token", {"text": chunk})


async def _run_action_flow(
    route: router.RouterResult,
    conv_id: int,
    attachment_ids: list[str],
    model: str,
    settings: dict[str, str],
    sink: list[str],
) -> AsyncIterator[Event]:
    """Propose (if needed), await confirmation, execute, and phrase the result."""
    intent = route.intent
    spec = get_action_spec(intent)
    if spec is None:
        yield ("error", {"message": f"No handler registered for intent {intent}."})
        return

    personality = settings.get("personality") or "friendly"
    assistant_name = settings.get("assistant_name") or "Luna"
    granted = is_permission_granted(spec.permission_category)
    preview, args = _build_preview(intent, dict(route.args))
    action_id = uuid.uuid4().hex

    # SPEC §4: read-only + already granted → skip the card. Destructive ops
    # always require explicit confirmation regardless of stored permission.
    needs_card = spec.destructive or not (granted and spec.read_only)

    approved = True
    if needs_card:
        yield (
            "action_proposal",
            {
                "action_id": action_id,
                "intent": intent,
                "label": spec.label,
                "params": {k: v for k, v in args.items() if k != "plan"},
                "preview": preview,
                "needs_permission": not granted,
                "permission_category": spec.permission_category,
            },
        )
        pending = _PendingAction()
        _pending_actions[action_id] = pending
        try:
            deadline = asyncio.get_event_loop().time() + ACTION_CONFIRM_TIMEOUT_SECONDS
            while not pending.event.is_set():
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break  # timeout → auto-deny
                try:
                    await asyncio.wait_for(pending.event.wait(), timeout=min(15.0, remaining))
                except asyncio.TimeoutError:
                    yield ("ping", None)  # SSE comment keepalive while waiting
            approved = pending.event.is_set() and pending.approved
            if approved and pending.remember_permission:
                grant_permission(spec.permission_category)
        except BaseException:
            # Client disconnected (tab closed, navigated away, task cancelled)
            # while a decision was pending. Without this, the exchange leaves
            # no trace at all — reopening the conversation shows nothing after
            # the user's message, as if it never happened. Leave a record.
            if not sink:
                sink.append(
                    "That needed your approval and we lost the connection before "
                    "you could respond, so I didn't do anything. Ask again anytime."
                )
            raise
        finally:
            _pending_actions.pop(action_id, None)

    if not approved:
        log_activity(intent, f"{spec.label} — denied by user", "denied")
        yield (
            "action_result",
            {
                "action_id": action_id,
                "status": "ok",
                "detail": "Cancelled — nothing was executed.",
                "data": {"denied": True},
            },
        )
        reply = prompts.deny_acknowledgement(personality, spec.label)
        sink.append(reply)
        yield ("token", {"text": reply})
        return

    # Summarizing a document is several sequential CPU LLM calls (map-reduce)
    # and can take a minute or two with no output. Emit an immediate note so the
    # user sees progress instead of dead silence — and so something is persisted
    # if they navigate away before the summary finishes.
    if intent == "summarize_document" and attachment_ids:
        intro = "Reading your document and summarizing it locally — this can take a minute on CPU…\n\n"
        sink.append(intro)
        yield ("token", {"text": intro})

    result = await _execute_action(intent, args, attachment_ids, model)
    status = result.get("status", "error")
    detail = result.get("detail", "")
    log_activity(intent, f"{spec.label} — {detail[:120]}", status)
    yield (
        "action_result",
        {
            "action_id": action_id,
            "status": status,
            "detail": detail,
            "data": result.get("data"),
        },
    )

    # Long-form outputs (summaries, drafts, search hits) ARE the reply —
    # avoid a redundant LLM call and just stream the content.
    if intent in ("summarize_document", "draft_email"):
        sink.append(detail)
        yield ("token", {"text": detail})
        return
    if intent == "search_files" and status == "ok":
        results = (result.get("data") or {}).get("results", [])
        lines = [detail] + [f"- `{r['path']}` ({r['modified']})" for r in results[:10]]
        reply = "\n".join(lines)
        sink.append(reply)
        yield ("token", {"text": reply})
        return

    # One short LLM call to phrase the outcome naturally, streamed as tokens.
    phrasing = prompts.build_action_result_prompt(
        assistant_name=assistant_name,
        personality=personality,
        intent=intent,
        label=spec.label,
        status=status,
        detail=detail[:400],
    )
    try:
        async for event in _stream_llm(phrasing, model, conv_id, sink):
            yield event
    except OllamaError:
        fallback = detail or ("Done." if status == "ok" else "That didn't work.")
        sink.append(fallback)
        yield ("token", {"text": fallback})
