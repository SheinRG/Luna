<div align="center">

# 🌙 Luna

**Your AI assistant that runs entirely on your own machine.**

Private by design · offline-first · desktop-native

</div>

---

Luna is a local-first AI desktop assistant for Windows. It chats, remembers what
matters, and actually *does* things on your computer — opening apps, finding
files, tidying folders, setting reminders — with a permission prompt before every
action. **No cloud. No accounts. Nothing leaves your laptop.** The language model
runs locally through [Ollama](https://ollama.com); the entire app works with your
network cable unplugged.

Built for the Luna Desktop Application Hackathon. The emphasis is product quality,
a real local-AI integration, and a safe, permission-based automation pipeline —
not a pile of half-working features.

## Why local, and why this model

The target machine is a modest laptop: **8 GB RAM, a 4-core Intel i5-1035G1, and no
discrete GPU** — every token is generated on the CPU, and RAM is the scarce
resource. That constraint drove every model decision:

| Choice | Reason |
|---|---|
| **`llama3.2:3b`** (chat, routing, summarizing) | The sweet spot for 8 GB CPU-only: ~2 GB resident, coherent, and fast enough to stream. 7B/8B models swap and thrash on this hardware; a 19 GB model can't load at all. |
| **`nomic-embed-text`** (memory) | 274 MB embedding model powering semantic memory recall — small enough to coexist with the chat model without a second heavyweight load. |
| **Ollama** as the runtime | Simple local server, streaming API, structured-output (JSON) support, and trivial model management. |
| **`faster-whisper tiny.en`** (voice input) | ~75 MB, int8, lazy-loaded only when you press the mic and **unloaded after 5 minutes idle** so it never competes with the LLM for RAM. |

Luna never loads two language models at once, caps context at 4096 tokens, and
keeps background model calls short and serialized — so it stays responsive and
won't cook a thin-and-light laptop.

## What it does — mapped to the brief

- **Welcome & setup** — a three-slide onboarding (on-device · memory you control ·
  permissioned automation) and a 30-second setup: your name, the assistant's name,
  theme, and model.
- **Chat** — streamed, markdown-rendered replies with code highlighting, file &
  image upload, conversation history, new-chat, and stop-generation.
- **Local AI** — all inference via Ollama on `127.0.0.1`; graceful, guided screens
  if Ollama isn't running or the model isn't pulled.
- **Personal memory** — Luna learns preferences and facts from conversation
  (semantic recall via embeddings), and you can review, add, edit, filter, or
  delete every memory. Nothing is hidden.
- **Desktop task assistant** — open installed apps, search local files, summarize
  documents (PDF/txt), create notes, reminders, and to-dos, draft emails, and
  organize the Downloads folder.
- **Intelligent automation** — an intent router turns natural language ("organize
  my downloads", "remind me tomorrow at 9", "find my resume", "open Spotify") into
  concrete actions through a proposal → **your approval** → execute → result
  pipeline, not just chat.
- **Safety & permissions** — every action category asks permission on first use;
  destructive operations (organizing Downloads) **always** show a preview plan and
  require explicit confirmation, and moves are journaled so you can undo.
- **Reminders** — fire as native Windows toast notifications.
- **Voice** — speech-to-text via on-device Whisper (mic button) and read-aloud via
  the OS's offline voices, with an auto-speak mode.
- **Privacy dashboard** — see and toggle granted permissions, review an action
  history timeline, view exactly what's stored and where, and delete all data.
- **Personalization** — assistant name, light/dark theme, six accent colors, font
  size, AI personality (Friendly / Professional / Concise / Playful), response
  length, and memory on/off.

**Deliberately out of scope** (to keep the core excellent): cloud APIs of any kind,
email/calendar OAuth, smart-home/IoT, wake-word, and image *understanding* (a
vision model won't fit alongside the LLM on 8 GB — images upload and degrade
gracefully instead of erroring).

## Architecture

```
Luna.exe  (PyInstaller onedir)
└─ luna/main.py
   ├─ FastAPI + uvicorn  →  127.0.0.1:<free port>     (background thread)
   ├─ pywebview window   →  the UI  (WebView2)          (main thread)
   │     fallback: Edge --app=<url>  →  default browser
   └─ reminder scheduler  →  winotify toasts            (background thread)

   core/     ollama client · chat engine (SSE) · intent router · memory · voice
   actions/  apps · files · documents · productivity   (each permission-gated)
   server/   REST + SSE routes                          (the §6 API contract)
   ui/       vanilla HTML/CSS/JS SPA, self-hosted fonts, fully offline
   db.py     SQLite  (%LOCALAPPDATA%\Luna\luna.db)
```

- **Backend:** Python 3.12, FastAPI, httpx, SQLite (stdlib).
- **Frontend:** dependency-free HTML/CSS/JS single-page app served by FastAPI;
  Instrument Sans / Instrument Serif / JetBrains Mono are vendored locally — no CDN.
- **Streaming:** Server-Sent Events; the chat stream stays open across the
  action-approval handshake.
- **Storage:** SQLite for conversations, messages, memories, reminders, todos,
  notes, settings, permissions, and the activity log. Notes are `.md` files.

Everything lives in one place you control: **`%LOCALAPPDATA%\Luna`**.

## Run from source

Prerequisites: [Ollama](https://ollama.com) and [uv](https://docs.astral.sh/uv/).

```powershell
# 1. Pull the models (once)
ollama pull llama3.2:3b
ollama pull nomic-embed-text

# 2. Make sure Ollama is running
ollama serve      # (or launch the Ollama app)

# 3. Run Luna  (uv auto-provisions Python 3.12 and installs deps)
uv run python -m luna.main
```

Luna opens in its own window. First launch shows onboarding; after setup you land
in chat.

## Build the Windows executable

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
# → dist\Luna\Luna.exe
```

An **onedir** build (not onefile) for faster startup and fewer antivirus false
positives. `luna/ui` is bundled; the Whisper voice model is *not* — it downloads
once, on first mic use, into `%LOCALAPPDATA%\Luna\whisper_models`. The end user
still needs Ollama running for local inference.

## Verified end-to-end

A live integration harness exercises 20 flows against the real backend + Ollama —
health, streamed chat, mid-stream stop, every action (approve **and** deny paths,
the organize-Downloads preview, a stored reminder), memory save→recall→delete,
txt/pdf/image upload + summarize, the voice pipeline, the activity log, and
delete-all — all green. See `SPEC.md` for the full contract and `REDESIGN.md` for
the UI design system.

## Privacy, plainly

Luna makes exactly zero outbound network requests during normal use. The model is
local, the database is local, uploaded files are processed locally, and the fonts
ship with the app. The only network traffic in the whole product's life is the
one-time model downloads you run yourself with `ollama pull` and the first-mic
Whisper download. You can watch what it does in the Privacy dashboard and wipe
everything with one button.
