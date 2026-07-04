# Luna — Technical Specification (v1)

AI-powered personal desktop assistant. Local-first, privacy-first, runs on modest hardware.
This document is the single source of truth. Backend and frontend are built against the
API contract in §6 — do not deviate from it without updating this file.

## 0. Hard constraints (non-negotiable)

- **Target machine**: Windows 11, 8 GB RAM total, Intel i5-1035G1 (4C/8T), integrated GPU only.
  Everything is CPU inference. RAM is the scarcest resource.
- **LLM**: Ollama (already installed, v0.30.7) at `http://127.0.0.1:11434`.
  Default model: `llama3.2:3b` (only model that fits comfortably). `nomic-embed-text` for embeddings.
  Never load two LLMs at once. `keep_alive: "15m"`, `num_ctx: 4096`.
- **Python**: 3.12 via `uv` (`uv venv --python 3.12 .venv`). NOT 3.14 (missing wheels).
- **Zero cloud calls.** Everything offline. This is a core selling point.
- **File ownership**: backend code lives in `luna/` (Python) — the backend agent must NOT create
  or edit anything under `luna/ui/`. The frontend owns `luna/ui/` (static HTML/CSS/JS) and must
  NOT touch any `.py` file. Integration happens in a later pass.

## 1. Product scope

IN (must work end-to-end): onboarding, setup, streaming chat + history, file upload
(txt/md/pdf; images accepted gracefully — see §7.3), personal memory with review/delete,
desktop actions with permission gates (§8), reminders with Windows toasts, voice in/out (§9),
settings, privacy dashboard, packaged `Luna.exe`.

OUT (deliberate cuts): calendar/email OAuth, smart-home, wake word, vision models, cloud APIs.

## 2. Architecture

```
Luna.exe (PyInstaller onedir)
└─ luna/main.py
   ├─ FastAPI + uvicorn on 127.0.0.1:<free port>   (thread)
   ├─ pywebview window → http://127.0.0.1:<port>/   (main thread)
   │    fallback: msedge --app=<url> if pywebview fails
   └─ background scheduler thread (reminders → winotify toasts)
```

```
Luna/
├─ SPEC.md
├─ pyproject.toml            # uv-managed; deps pinned
├─ build.ps1                 # PyInstaller build script
├─ luna/
│  ├─ main.py                # entry: port pick, uvicorn thread, webview window
│  ├─ config.py              # data dir = %LOCALAPPDATA%/Luna ; dev override via env
│  ├─ db.py                  # sqlite3 (stdlib), schema + migrations, WAL mode
│  ├─ server/
│  │  ├─ app.py              # FastAPI app factory, static mount of luna/ui at /
│  │  └─ routes/             # chat.py, conversations.py, memories.py, actions.py,
│  │                         # settings.py, voice.py, misc.py (health/upload/activity/data)
│  ├─ core/
│  │  ├─ ollama_client.py    # httpx; stream chat; embeddings; health; model list
│  │  ├─ chat_engine.py      # orchestrates: recall → router → (action|chat) → SSE events
│  │  ├─ router.py           # intent detection: regex fast-paths + LLM JSON fallback
│  │  ├─ memory.py           # save/recall (cosine over nomic embeddings), post-chat extraction
│  │  ├─ prompts.py          # all system prompts / personas in one place
│  │  └─ voice.py            # sounddevice record; faster-whisper lazy STT; pyttsx3 TTS fallback
│  ├─ actions/
│  │  ├─ registry.py         # action metadata: id, label, permission category, risk
│  │  ├─ apps.py             # launch installed apps (Start Menu .lnk scan + shell start)
│  │  ├─ files.py            # search files; organize Downloads (plan → confirm → move, undo log)
│  │  ├─ documents.py        # extract text (pypdf/plain), chunked summarize
│  │  └─ productivity.py     # notes (.md in data dir), reminders, todos, draft email
│  └─ ui/                    # FRONTEND ONLY — see §7
└─ assets/icon.ico
```

Dependencies (keep to this list): fastapi, uvicorn, httpx, pydantic, pywebview,
python-multipart, pypdf, winotify, sounddevice, numpy, faster-whisper, pyttsx3, pyinstaller (dev).

## 3. Data model (SQLite, `%LOCALAPPDATA%/Luna/luna.db`)

- `conversations(id, title, created_at, updated_at)` — title auto-generated from first message.
- `messages(id, conversation_id, role, content, attachments_json, created_at)`
- `memories(id, text, category, source, embedding BLOB, created_at)`
  categories: `preference | fact | app | style | other`; source: `explicit | extracted | manual`
- `settings(key, value)` — user_name, assistant_name (default "Luna"), theme, font_size,
  personality, response_length, model, voice_enabled, auto_speak, memory_enabled, onboarded
- `permissions(category, granted, updated_at)` — categories: `apps | files | notifications | voice`
- `activity_log(id, action_id, description, status, created_at)`
- `reminders(id, text, due_at, fired, created_at)` ; `todos(id, list_name, item, done)` ;
  `notes(id, title, path, created_at)`

## 4. Chat engine flow (per user message)

1. Persist user message. If memory_enabled: embed message, recall top-4 memories with
   cosine ≥ 0.55, inject as `Known about the user: …` into system prompt.
2. **Router** (§5) classifies: `chat` or a specific action intent.
3. `chat` → stream `POST /api/chat` (Ollama) tokens out as SSE `token` events.
4. Action intent → emit SSE `action_proposal` (id, label, params, preview, needs_permission).
   Frontend renders a card; user approves/denies via `POST /api/actions/confirm`.
   On approve: execute, emit `action_result`, then one short LLM call to phrase the outcome
   naturally, streamed as tokens. On deny: acknowledge politely, no execution.
   Exception: if permission category already granted AND action is read-only
   (search_files, summarize), execute immediately — no card, just `action_result` + response.
5. After `done`: async fact-extraction (one 3B JSON call) — only if the exchange contains
   personal info; dedupe against existing memories by cosine ≥ 0.86 before insert.

## 5. Intent router

Layer 1 — regex fast-paths (no LLM, instant): "open/launch X", "remind me …", "find/search
(for) my X", "organize downloads", "note: …" etc.
Layer 2 — LLM classification with Ollama `format: json`, schema:
`{"intent": "chat|open_app|search_files|summarize_document|create_note|draft_email|set_reminder|create_todo|organize_downloads|remember", "args": {…}, "confidence": 0-1}`.
Confidence < 0.6 → treat as `chat`. Keep the router prompt ≤ 300 tokens; it runs before every
non-fast-path message and must stay cheap.

## 6. API contract (REST + SSE, base `http://127.0.0.1:<port>`)

- `GET  /api/health` → `{ollama: "ok"|"down"|"model_missing", models: [...], active_model, data_dir}`
- `POST /api/chat` `{conversation_id?, message, attachment_ids: []}` → **SSE** stream:
  - `event: meta`            `{conversation_id, message_id}`
  - `event: token`           `{text}`
  - `event: action_proposal` `{action_id, intent, label, params, preview, needs_permission, permission_category}`
  - `event: action_result`   `{action_id, status: "ok"|"error", detail, data?}`
  - `event: memory_saved`    `{id, text}`
  - `event: done`            `{message_id}`
  - `event: error`           `{message}`
- `POST /api/chat/stop` `{conversation_id}`
- `POST /api/actions/confirm` `{action_id, approved, remember_permission?}` → continues the
  pending SSE stream (stream stays open while waiting; 120 s timeout → auto-deny)
- `GET/POST/DELETE /api/conversations` ; `GET /api/conversations/{id}/messages`
- `GET/POST/PUT/DELETE /api/memories`
- `GET/POST/PUT/DELETE /api/reminders`, `/api/todos`, `/api/notes`
- `GET/PUT /api/settings` (flat JSON object) ; `GET/PUT /api/permissions`
- `GET /api/activity?limit=100`
- `POST /api/upload` (multipart) → `{attachment_id, name, kind: "text"|"pdf"|"image", chars?}`
- `POST /api/voice/record` `{action: "start"|"stop"}` → stop returns `{text}`
- `POST /api/voice/speak` `{text}` (pyttsx3 fallback; frontend prefers speechSynthesis)
- `POST /api/data/delete-all` → wipes DB + uploads + notes, returns to onboarding

## 7. Frontend (`luna/ui/` — static, no build step)

Vanilla HTML/CSS/JS, ES modules. Vendored libs only (no CDN — app is offline):
`marked.min.js`, `highlight.min.js` + one hljs theme, downloaded into `ui/vendor/` at dev time.

### 7.1 Screens (SPA, hash-routed)
1. **Onboarding** (first run): 3 animated slides — "Runs entirely on your device",
   "Remembers what matters — you stay in control", "Automates your desktop, with your
   permission". Skippable.
2. **Setup**: your name, assistant name (default Luna), theme (dark default / light),
   model picker fed by `/api/health` — mark `llama3.2:3b` as "✓ Recommended for this PC",
   warn on models > 3 GB ("may be slow on 8 GB RAM").
3. **Chat** (main): sidebar (new chat, history list w/ delete, nav to Memory / Tasks /
   Privacy / Settings), message list (markdown, code highlight w/ copy button, streaming
   cursor), action cards (proposal → approve/deny → result state), attachments (📎 picker +
   drag-drop), mic button (hold-to-talk or click-start/click-stop), 🔊 read-aloud per
   assistant message + auto-speak toggle, stop-generation button, typing indicator
   "Luna is thinking…".
4. **Memory**: list stored memories w/ category chips, add / edit / delete, "delete all".
5. **Tasks**: reminders (list + create with natural due time), todos (checkable), notes list.
6. **Privacy dashboard**: permission toggles per category, activity history timeline,
   stored-data summary (counts + data folder path), "Delete all my data" (double confirm).
7. **Settings**: names, theme, font size, personality preset (Friendly / Professional /
   Concise / Playful), response length, model, voice toggles, memory on/off.

### 7.2 Design direction
"Luna" = calm night-sky aesthetic. Dark theme default: deep indigo/near-black background
(#0d1020 range), soft violet/lavender accent, subtle glass blur on sidebar/cards, gentle
moon-glow gradient behind the empty-chat hero ("Good evening, {name} 🌙 — what can I do for
you?"). Rounded 12–16 px radii, Inter/system font stack, 150–200 ms ease transitions,
respectable light theme. Polish > flash; judges score UI/UX explicitly. Keyboard: Enter to
send, Shift+Enter newline, Esc stops generation.

### 7.3 Graceful degradation (must-have)
- Ollama down / model missing → friendly full-screen guide (exact commands to run) + Retry.
- Image uploaded → show thumbnail in the message; Luna replies honestly that she runs a
  lightweight text-only model to stay fast on this hardware and offers to work with the
  file name/metadata instead. Never error.
- Voice unavailable (mic/model failure) → mic button hidden with tooltip, never crash.
- First token slow (CPU): show status line under composer: "thinking → writing".

## 8. Actions & safety

Every action: registered in `registry.py` with a permission category; first use of a category
triggers the proposal card with "Allow once / Always allow / Deny"; every execution appends to
`activity_log`. Destructive ops (`organize_downloads`) ALWAYS show a preview plan (files →
target subfolders by type: Images/, Docs/, Archives/, Installers/, Media/, Other/) and require
explicit confirm regardless of stored permission; moves are journaled to allow "undo last
organize". App launching resolves from Start Menu `.lnk` scan (both ProgramData and AppData)
with fuzzy name match. File search: `os.scandir` walk of Desktop/Documents/Downloads, depth ≤ 4,
skip hidden/node_modules/venv, cap 200 hits, return top 20 ranked by name match + mtime.

## 9. Voice

- **STT**: `faster-whisper` `tiny.en`, int8, lazy-loaded on first mic use, unloaded after
  5 min idle (RAM!). Recording via `sounddevice` (16 kHz mono) in the backend — avoids WebView2
  mic-permission issues. Transcription completes BEFORE the LLM call starts (never concurrent).
- **TTS**: frontend `speechSynthesis` (WebView2 ships Windows voices, offline) as primary;
  `pyttsx3` behind `/api/voice/speak` as fallback. Auto-speak mode reads each reply when done.

## 10. Packaging & docs

- `build.ps1`: PyInstaller **onedir** (NOT onefile — slow start + AV false positives),
  `--name Luna --icon assets/icon.ico --noconsole`, bundle `luna/ui` via `--add-data`,
  faster-whisper model NOT bundled (downloads to data dir on first mic use; document it).
- README.md: what/why, model-choice justification (3B on 8 GB CPU-only), architecture sketch,
  run-from-source (`uv sync; uv run python -m luna.main`), build steps, feature walkthrough
  mapped to the hackathon brief, cut-scope rationale.
- DEMO_SCRIPT.md: 3–5 min shot list covering every brief section.
