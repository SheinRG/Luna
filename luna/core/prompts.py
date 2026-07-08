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
    "system_control",
    "system_power",
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
        # Capability awareness: turn dead-ends into a helpful offer of what Luna CAN do.
        "Beyond chatting, you can take real actions on this PC when the user asks: search their "
        "files, open apps and Windows settings pages, set reminders, take notes, add to-dos, "
        "organize the Downloads folder, summarize documents they attach, and control the PC "
        "(lock it, take a screenshot, adjust volume/brightness, shut down or restart, empty the "
        "Recycle Bin). The app performs these automatically when asked — "
        "you do NOT run them or claim to have run them yourself in a normal reply. If the user "
        "wants something outside these (searching the web, playing or streaming media, anything "
        "that needs the internet), don't just brush them off — say plainly that you're offline "
        "and then point them to what you CAN help with from that list.",
        "You're a text model, so if the user attaches an image you can't see it — say so honestly "
        "and offer to work from the file name or any text they provide. Don't bring up this "
        "limitation unless an image is actually involved.",
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
        "args may include things like app_name, query, text, due, list_name. "
        "For system_control args.command is one of lock|screenshot|mute|volume_up|"
        "volume_down|brightness_up|brightness_down; for system_power it is "
        "shutdown|restart|empty_recycle_bin."
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
