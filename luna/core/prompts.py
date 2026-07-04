"""All system prompts and persona text in one place (SPEC §2).

Keeping every prompt here makes tone/persona changes a one-file edit and
keeps the router/extraction prompts easy to audit for token cost.
"""

from __future__ import annotations

import json

PERSONALITY_STYLES: dict[str, str] = {
    "friendly": "warm, encouraging, and conversational",
    "professional": "polished, precise, and businesslike",
    "concise": "terse and to the point, no small talk",
    "playful": "upbeat, witty, and a little playful",
}

RESPONSE_LENGTH_STYLES: dict[str, str] = {
    "short": "Keep replies to 1-3 sentences unless the user explicitly asks for more detail.",
    "balanced": "Keep replies to a short paragraph or two — enough detail to be useful without rambling.",
    "long": "Feel free to be thorough; explain reasoning and give examples when it helps.",
}

# Intents the router can classify a message into (SPEC §5).
ROUTER_INTENTS: list[str] = [
    "chat",
    "open_app",
    "search_files",
    "summarize_document",
    "create_note",
    "draft_email",
    "set_reminder",
    "create_todo",
    "organize_downloads",
    "remember",
]


def build_system_prompt(
    *,
    assistant_name: str,
    personality: str,
    response_length: str,
    memories: list[str] | None = None,
) -> str:
    """Compose the chat system prompt: persona + recalled memories."""
    style = PERSONALITY_STYLES.get(personality, PERSONALITY_STYLES["friendly"])
    length = RESPONSE_LENGTH_STYLES.get(response_length, RESPONSE_LENGTH_STYLES["balanced"])
    lines = [
        f"You are {assistant_name}, a local, privacy-first AI desktop assistant that runs "
        "entirely on the user's own PC. You never call the cloud and nothing leaves this machine.",
        f"Tone: {style}. {length}",
        "You run on a lightweight 3B-parameter text-only model chosen to stay fast on modest "
        "hardware. If the user shares an image, say so honestly and offer to work from the "
        "file name or any provided text/metadata instead — never pretend to see an image.",
        "Use markdown when it helps (lists, fenced code blocks with a language tag), but don't "
        "over-format simple answers.",
    ]
    if memories:
        joined = "\n".join(f"- {m}" for m in memories)
        lines.append(f"Known about the user (use naturally, don't recite verbatim):\n{joined}")
    return "\n\n".join(lines)


def build_router_prompt(message: str) -> list[dict[str, str]]:
    """Compact (~<300 token) prompt for the LLM intent-classification fallback."""
    schema = json.dumps(ROUTER_INTENTS)
    system = (
        "Classify the user's message into exactly one intent for a desktop assistant. "
        f"Respond with ONLY compact JSON, no prose, no markdown fences, schema: "
        f'{{"intent": one of {schema}, "args": {{}}, "confidence": number 0-1}}. '
        "Use \"chat\" for anything conversational, a question, or unclear. "
        "args may include things like app_name, query, text, due, list_name."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": message},
    ]


def build_fact_extraction_prompt(user_message: str, assistant_message: str) -> list[dict[str, str]]:
    """Prompt for the post-response async fact-extraction call (SPEC §4 step 5)."""
    system = (
        "Extract durable personal facts or preferences about the user worth remembering "
        "long-term from this exchange (things like their name, job, likes/dislikes, habits, "
        "tools they use, how they like responses formatted). Respond with ONLY JSON: "
        '{"facts": [{"text": "short third-person statement", '
        '"category": "preference|fact|app|style|other"}]}. '
        'Return {"facts": []} if there is nothing durable — small talk, one-off commands, '
        "or questions with no new info about the user do not count."
    )
    user = f"User said: {user_message}\nAssistant replied: {assistant_message}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def build_action_result_prompt(
    *,
    assistant_name: str,
    personality: str,
    intent: str,
    label: str,
    status: str,
    detail: str,
) -> list[dict[str, str]]:
    """Prompt for the short LLM call that phrases an action's outcome naturally."""
    style = PERSONALITY_STYLES.get(personality, PERSONALITY_STYLES["friendly"])
    system = (
        f"You are {assistant_name}, {style}. The user just approved an action and it has "
        "already run. In 1-2 short sentences, tell them the outcome naturally — do not "
        "repeat raw data structures or say 'the action' or 'the tool'."
    )
    user = f"Action: {label} ({intent})\nStatus: {status}\nDetail: {detail}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def deny_acknowledgement(personality: str, label: str) -> str:
    """Canned (non-LLM) acknowledgement when the user denies an action proposal."""
    style_phrases = {
        "friendly": f"No worries, I won't {label.lower()}. Anything else?",
        "professional": f"Understood — I will not proceed with: {label}.",
        "concise": "Okay, skipped.",
        "playful": f"Got it, backing off from \"{label}\" — your call!",
    }
    return style_phrases.get(personality, style_phrases["friendly"])
