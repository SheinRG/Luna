# Luna — Demo Video Script (3–5 minutes)

A tight, confident walkthrough that hits every judged area: product thinking,
local AI, intelligent automation, safety, memory, and polish. Times are targets;
aim for **~4:00**. Speak in short sentences. Let the streaming and the toast
*happen on camera* — the realness is the point.

---

## Pre-demo checklist (do this before you hit record)

- [ ] **Ollama is running** — `ollama serve` (or the tray app). Confirm:
      `curl http://127.0.0.1:11434/api/version`.
- [ ] **Model is warm** — send one throwaway message first so the first on-camera
      reply streams fast instead of paying the cold-load cost.
- [ ] **Whisper is pre-downloaded** — click the mic once before recording so the
      ~75 MB model is already on disk (no mid-demo download stall).
- [ ] **Windows notifications enabled** (Focus Assist OFF) so the reminder toast
      actually appears.
- [ ] **Reset to a fresh state** so onboarding shows — Privacy → *Delete all my
      data*, or run against a clean data dir. Re-add a memory or two if you want
      the Memory screen to look lived-in.
- [ ] Put a **resume-like file** in Documents and a few junk files in **Downloads**
      so "find my resume" and "organize my downloads" have real material.
- [ ] Close other RAM-hungry apps (Chrome tabs, etc.) — this is an 8 GB machine.
- [ ] Have a small **PDF** handy on the desktop for the summarize beat.

---

## Shot list

### 0:00 — Cold open (15s)
> "This is Luna — an AI assistant that runs **entirely on my laptop**. No cloud,
> no account. The model, my data, everything stays on this machine."

Launch `Luna.exe`. Let the onboarding slides animate. Don't read them aloud —
just let them breathe for a beat, then click through.

### 0:15 — Setup (20s)
On the setup screen, type your name, keep "Luna", pick the **Night** theme, and
point at the model row:
> "It runs on Llama 3.2 3B through Ollama — the right size for a CPU with 8 gigs of
> RAM. Luna even tells me which model fits."

Click **Start talking to Luna**.

### 0:35 — First chat, streaming (30s)
Land on the hero ("Good evening…"). Click a suggested prompt or ask something real:
> "Give me three ideas for a weekend project."

Let the answer **stream in** on camera.
> "That's generated locally, token by token — nothing left the laptop."

### 1:05 — Memory (35s)
Type:
> "Remember that I prefer short, direct answers and I use Neovim."

Point at the **"Remembered"** line under the reply. Open **Memory** in the rail:
> "Everything Luna learns is right here — I can see it, edit it, or forget it.
> Nothing hidden."

Start a **new chat** and ask:
> "What's my favorite editor?"

It answers "Neovim" — *without* being told again.
> "It recalled that from memory, in a brand-new conversation."

### 1:40 — Intelligent automation + safety (60s) — **the centerpiece**
Ask:
> "Organize my Downloads folder."

When the **action card** appears, slow down and narrate the safety story:
> "Here's the important part. Luna doesn't just *do* things. It shows me a plan —
> 34 files into 5 folders — and waits. I have to approve it."

Click **Approve**, show the result, then immediately do a launch action:
> "Open Notepad."

Approve → Notepad opens on screen.
> "Every action asks first, and every permission is revocable."

Then a read-only one to show it's smart about friction:
> "Find my resume."

It returns ranked results. (Optionally mention it didn't need a card because
searching is read-only and already permitted.)

### 2:40 — Reminder + live toast (25s)
> "Remind me in one minute to stretch."

Approve. Then — this is the money shot — **keep talking and let the Windows toast
fire on camera** a moment later:
> "That's a native Windows notification, from a reminder I set in plain English."

*(If you don't want to wait live, set it for the shortest interval and cut to the
toast — but a real, unedited toast lands best.)*

### 3:05 — Document summarize + upload (25s)
Drag a **PDF** onto the composer (or use the 📎):
> "Summarize this."

Let it stream a summary.
> "Files are read and summarized locally too."

*(Optional: drop in an image to show the honest, graceful "I'm a text-only model
to stay fast on this hardware" response — a nice product-maturity beat.)*

### 3:30 — Voice (20s)
Click the **mic**, speak:
> "What can you help me with?"

Show the transcription appear and the reply; toggle **read-aloud** so it speaks
back.
> "Speech-to-text is on-device Whisper. Text-to-speech uses Windows' built-in
> voices. Still fully offline."

### 3:50 — Privacy dashboard + personalization (25s)
Open **Privacy**:
> "Because it's private-first, I get a dashboard: what Luna can access, every
> action it's taken, exactly what's stored and where — and one button to delete
> all of it."

Jump to **Settings**, flip **Night → Day** and change the **accent** color live:
> "And it's genuinely mine — themes, accent, personality, response length."

### 4:15 — Close (10s)
Back to chat.
> "Luna — a private, local AI assistant that doesn't just talk, it gets things
> done. All on my own machine."

---

## If you're tight on time, cut in this order
1. Voice (3:30) → 2. Document summarize (3:05) → 3. the "find my resume" sub-beat.
**Never cut:** the organize-Downloads approval card (safety) or the live reminder
toast (automation) — those are the strongest, most-judged moments.

## One-liners worth landing
- "Nothing leaves this laptop."
- "It shows me a plan and waits for approval."
- "It remembered that — in a new conversation."
- "A real Windows notification, from plain English."
