# Luna — Redesign Spec ("minimal approach")

Source: Claude Design project "App redesign minimal approach", files `Luna Redesign.dc.html`
(chat + Memory/Tasks/Privacy/Settings) and `Luna Redesign - First Run.dc.html` (onboarding + setup).
This is a **visual redesign only**. The API contract (SPEC.md §6), all JS wiring (SSE parsing,
api.js, state.js, router.js, upload, voice), and all functionality stay exactly as-is. Do NOT change
behavior, event names, endpoints, or the graceful-degradation states — only presentation/markup/CSS.

## Design language (the essence)
Calm, editorial, near-black. Thin hairline dividers instead of boxes. Serif-italic display type for
warmth against a mono/sans UI. One lavender accent. Lots of negative space. No heavy glass/shadows —
the previous design's glassmorphism is REPLACED by flat surfaces + 1px hairlines.

## Typography (self-host — app is offline, NO CDN at runtime)
Download woff2 into `luna/ui/vendor/fonts/` and declare `@font-face` (add a `vendor/fonts.css`, link it
first). Families:
- **Instrument Sans** (400,500,600) — all UI text. Stack: `'Instrument Sans', system-ui, sans-serif`.
- **Instrument Serif** (400, plus italic) — display headings & hero greeting, always `font-style: italic`,
  `font-weight: 400`. Stack: `'Instrument Serif', Georgia, serif`.
- **JetBrains Mono** (400,500) — model ids, file paths, code, status text, card previews, stat numbers'
  companions. Stack: `'JetBrains Mono', ui-monospace, monospace`.
If a download fails, fall back to the stacks above (don't block the build), but try hard to vendor them.

## Color tokens — drive everything from CSS custom properties on `:root` (or a theme wrapper)
Theme is chosen by `settings.theme` = `night` (default/dark) or `day` (light). Accent is
`settings.accent` (default `#ACA0F2`). Set both as data attributes / inline vars at the app root.

### Night (default)
```
--bg0:#0B0C12  --bg1:#0E1017  --surface:#14161F
--line:rgba(255,255,255,0.06)  --line2:rgba(255,255,255,0.10)
--tx1:#E9EAF0  --tx2:#9A9DAD  --tx3:#62667A
--accent:<accent>  --accentInk:#101018
--ok:#7FBFA0  --danger:#D98A8A  --dangerLine:rgba(217,138,138,0.35)
```
### Day
```
--bg0:#F6F6F8  --bg1:#FDFDFE  --surface:#EFEFF4
--line:rgba(24,26,44,0.07)  --line2:rgba(24,26,44,0.13)
--tx1:#1B1C26  --tx2:#585B6C  --tx3:#9295A6
--accent:<accent>  --accentInk:#14151E
--ok:#4E9A75  --danger:#BC5F5F  --dangerLine:rgba(188,95,95,0.35)
```
### Accent options (Settings → Appearance swatches)
`#ACA0F2` (default), `#9FB2E8`, `#8FBFC9`, `#9FC9A4`, `#C9B48F`, `#C99FAE`.
`--accentInk` is the text/icon color placed ON the accent (dark), keep as per theme above.

Token roles: `--bg0` = app/rail/composer bg; `--bg1` = main content bg; `--surface` = raised chips,
user bubble, active rail item, switch-off track; `--line` = hairline dividers/rows; `--line2` = input &
button borders; `--tx1/2/3` = primary/secondary/tertiary text; `--ok` green dot; `--danger` destructive.

## Global CSS
- `* { box-sizing:border-box }`, remove focus outlines on input/textarea/button (custom focus = accent border).
- Thin scrollbars: `scrollbar-width:thin; scrollbar-color:rgba(158,160,180,0.25) transparent`; webkit width 8px,
  thumb `rgba(158,160,180,0.25)` radius 999px.
- Keyframes: `breathe` (6s: scale 1→1.06, opacity 1→.85, ease-in-out infinite — used on the moon logo &
  thinking indicator at 1.6s), `rise` (from opacity0/translateY(8–10px) to 0 — message + screen entrance,
  ~300–400ms), `dotpulse` (opacity 1→.3 — pending action dot, 1.4s).
- Respect `prefers-reduced-motion`.

## Crescent moon logo (inline SVG, fill `var(--accent)`)
`<svg viewBox="0 0 64 64"><path fill="var(--accent)" d="M42.8 8.2A26 26 0 1 0 55.8 41 21 21 0 0 1 42.8 8.2z"/></svg>`
Sizes: 22px in rail, 40px hero, 36px onboarding, 26px setup, 15px thinking indicator.

## LAYOUT — replace wide sidebar with a 64px icon RAIL
`aside` width 64px, full height, `flex-direction:column; align-items:center; padding:20px 0 16px; gap:8px;
border-right:1px solid var(--line); background:var(--bg0)`. Top→bottom:
1. Moon logo (22px, margin-bottom 12px).
2. **New chat** — 38×38, border `1px var(--line2)`, radius 12, transparent, `+` icon (tx2). Hover: border+icon accent. margin-bottom 8px.
3–6. Nav icon buttons (38×38, radius 12): **Chat** (speech bubble), **Memory** (brain), **Tasks** (checklist),
   **Privacy** (shield-check). Inactive: transparent bg, `--tx3` icon. Active: `background:var(--surface); color:var(--accent)`.
   Hover (inactive): `color:var(--tx1); background:var(--surface)`. Use `title=` tooltips.
7. spacer `flex:1`.
8. **Settings** (gear) at bottom, same button treatment.
Main area: `flex:1; background:var(--bg1)`. The old sidebar's conversation-history list is REMOVED from the
side — recent chats now live under the composer (see Chat). Keep all router navigation working.

## CHAT screen
- **Top bar** (h52, padding 0 24px): left = conversation title in `--tx2` 14px/500 (ellipsis); right = status
  cluster in JetBrains Mono 12px `--tx3`: a 6px `--ok` dot + `llama3.2:3b · local` (use the active model id from
  /api/health, and show `· local`). If Ollama down, reflect that here too (dot `--danger`, e.g. `offline`).
- **Hero** (empty conversation): centered column. Breathing 40px moon; `h1` Instrument Serif italic 42px
  greeting `{{ greeting }}` (time-aware: "Good morning/afternoon/evening, {name}" — keep existing greeting
  logic, just restyle); sub `Everything stays on this device.` in `--tx3` 15px. Then a **vertical prompt list**
  (width min(420px,100%)): each prompt is a full-width button, `padding:13px 4px`, only a `border-bottom:1px
  var(--line)`, text `--tx2` 14px left, a faint arrow (→) icon right; hover → text `--tx1`. Prompts:
  "Organize my Downloads folder", "Find my resume", "Remind me tomorrow at 9 to stretch", "Summarize a PDF for me".
  Clicking sends that text.
- **Messages** (max-width 680px, centered, gap 28px, padding 24px 24px 40px):
  - **User**: right-aligned. Bubble `max-width:78%; padding:11px 16px; background:var(--surface);
    border:1px solid var(--line); border-radius:16px 16px 4px 16px; font-size:15px; line-height:1.6;
    white-space:pre-wrap`. `rise` animation.
  - **Assistant**: left, NO bubble — plain text `font-size:15px; line-height:1.7; color:var(--tx1)`.
    Markdown + code highlighting stays (keep marked/hljs + copy buttons; style code blocks to fit the palette).
  - **Action card** (assistant, inline above text): `border:1px solid var(--line2); border-radius:14px; overflow:hidden`.
    Header row (padding 12px 16px): status **dot** (7px) + label 14px/500 (flex1) + `cardStatus` in mono 12px `--tx3`.
    Dot color by state: pending = `--accent` + `dotpulse`; done/ok = `--ok`; denied/neutral = `--tx3`; error = `--danger`.
    Optional **preview** block (border-top var(--line), mono 12px/1.7 `--tx2`, pre-wrap) — e.g.
    `34 files → 5 folders\nImages 12 · Docs 9 · …`. **Pending** → button row (border-top): **Approve**
    (accent bg, accentInk text, radius10, 7px 16px, 13px/600) + **Deny** (border var(--line2), transparent,
    `--tx2`). **Result** → text block (border-top, 13px `--tx2`), e.g. "Moved 34 files. Say "undo last
    organize" to roll it back." Card statuses: `needs approval` / `done` / `denied` / `running…` / `error`.
  - **Thinking**: row with 15px breathing moon (1.6s) + `thinking…` in `--tx3` 13px.
  - **Memory pill**: row, 5px accent dot + `Remembered — {text}` in `--tx3` 12px.
- **Composer** (bottom, max-width 680px): a pill `display:flex; align-items:flex-end; gap:4px;
  border:1px solid var(--line2); border-radius:18px; padding:6px 6px 6px 8px; background:var(--bg0)`;
  focus-within → border accent. Left **attach** icon-button (36×36, radius12, `--tx3`→`--tx1` hover, paperclip);
  auto-growing **textarea** (rows1, max-height180, transparent, 15px/1.55, placeholder "Ask Luna anything…");
  **mic** icon-button (hidden if voice unavailable per health); **send** button (36×36, radius13, accent bg,
  accentInk up-arrow icon; hover brightness1.08; active scale .93). Enter=send, Shift+Enter=newline, Esc=stop.
  While streaming, send becomes a **stop** control (keep existing stop wiring).
- **Recent chats footer** (under composer, only if history exists): `Recent` label (mono-ish uppercase 11px
  `--tx3`, letter-spacing .08em) followed by up to ~3–5 recent conversation title buttons (12px, `--tx3`,
  active/open = `--tx1`; hover `--tx1`). Clicking opens that conversation. This REPLACES the sidebar history.

## MEMORY screen (content max-width 640px, padding 48px 40px, `rise`)
- Header row: `h2` serif italic 32px "Memory" + right-aligned text button "Forget everything" in `--danger`
  (hover underline) → double-confirm, calls DELETE /api/memories (collection).
- Sub `--tx3` 14px: "What Luna knows about you — stored on this device only."
- Add input (radius12, border var(--line2), transparent, focus accent) placeholder "Add something Luna
  should remember…" → Enter adds a manual memory (POST /api/memories).
- **Filter row** (text tabs, not chips): `all preference fact app style` — active = `--tx1` + 1px accent
  bottom-border; others `--tx3`. Capitalize labels.
- **List**: each row `display:flex; align-items:center; gap:14px; padding:16px 4px; border-bottom:1px
  var(--line)`. Left category **dot** (7px) colored: preference=`--accent`, fact=`#7FA8C9`, app=`--ok`,
  style=`#C9B47F`, other=`--tx3`. Middle: text 15px + meta `--tx3` 12px ("you told Luna · 2 days ago" /
  "learned from chat · …" / "added here · …"). Right: an X delete icon-button (`--tx3`→`--danger` hover).

## TASKS screen (max-width 640px, padding 48px 40px)
- `h2` serif italic 32px "Tasks"; sub `--tx3` 14px "Reminders arrive as Windows toasts — or just ask Luna in chat."
- **Tab bar** (bottom-border container): `Reminders` / `To-dos` / `Notes`; active = `--tx1` + accent
  bottom-border (−1px to sit on the container line); inactive `--tx3`.
- **Reminders**: add input placeholder "Remind me to… (e.g. stretch, tomorrow at 9)" → creates reminder.
  Rows (border-bottom): title + due line. Due styling by state: normal `--tx3`; **overdue** → `--danger`
  ("Overdue — …"); **fired/delivered** → title struck/dimmed, due "Delivered — …" `--tx3`. X delete.
- **To-dos**: add input "Add a to-do…". Rows: a round **checkbox** (18px, border var(--line2), radius:50%;
  checked = accent fill + accentInk check icon) toggles done; done item text = `--tx3` + line-through. X delete.
- **Notes**: add input "New note title…". Rows: title 15px + path in mono 12px `--tx3` (ellipsis) + relative
  time on the right. (Path e.g. `%LOCALAPPDATA%\Luna\notes\...`.)

## PRIVACY screen (max-width 640px, padding 48px 40px)
- `h2` serif italic 32px "Privacy"; sub `--tx3` 14px "Fully offline. Nothing leaves this laptop — here's
  exactly what Luna can do and what she's stored."
- **Permissions** section (uppercase 11px `--tx3` label, letter-spacing .1em). Rows (border-bottom): name
  (capitalize) + desc `--tx3` 12px, right a **switch**. Categories/descs:
  - apps — "Launch installed applications"
  - files — "Search and organize your files"
  - notifications — "Send reminder toasts"
  - voice — "Show the mic button (on-device Whisper)"
  Toggling PUTs /api/permissions. (Use real descs; keep them short. The .dc had generic ones — these match SPEC §3 categories.)
- **Action history** section: rows (border-bottom) = small status dot + description (14px) + relative time
  right (`--tx3` 12px). Dot: ok=`--ok`, error=`--danger`. Feed from GET /api/activity. Example strings:
  "Organized Downloads — moved 34 files into 5 folders", "Searched files for "resume"", "Launched Spotify",
  "Reminder toast: "Stand-up prep"", "Couldn't open "Photoshop" — not installed" (error).
- **Stored on this device** section: a horizontal row of stats — big number (22px/600 tabular-nums) + label
  `--tx3` 13px: conversations, memories, reminders, to-dos, notes (counts from backend). Below, the data dir
  path in JetBrains Mono 12px `--tx3` (from /api/health `data_dir`).
- **Delete all my data…** button: outline `--dangerLine`, text `--danger`, radius12; hover → danger bg +
  `--bg0` text. Double-confirm → POST /api/data/delete-all → back to onboarding.

## SETTINGS screen (max-width 640px, padding 48px 40px)
- `h2` serif italic 32px "Settings"; sub `--tx3` 14px "Changes save automatically and stay on this device."
- Grouped sections; each group: uppercase 11px `--tx3` title, then rows (border-bottom, `display:flex;
  align-items:center; gap:20px; padding:16px 4px; flex-wrap:wrap`): left = label 15px + desc `--tx3` 12px;
  right = the control. Controls: **text input** (180px, radius11, border var(--line2), focus accent),
  **segmented** (inline-flex tiny buttons; active = `--tx1` + accent underline or filled per style below),
  **switch**, **model picker** (stacked buttons, see below). Groups & rows:
  - **Appearance**: Theme (segmented Night/Day) · Accent (6 color swatch buttons; selected = ring in accent) ·
    Font size (segmented S/M/L → scales a root `--font-scale`).
  - **Conversations/You**: Your name (text) "Used in greetings and to personalize replies" · Assistant name
    (text) "What your assistant answers to".
  - **Assistant**: Personality (segmented Friendly/Professional/Concise/Playful) "Sets the tone of every reply" ·
    Response length (segmented Short/Medium/Long) "Short answers are faster on this hardware".
  - **Intelligence**: Model (model picker) "Which local Ollama model Luna thinks with" · Memory (switch)
    "Remember preferences and facts across chats".
  - **Voice**: Voice input (switch) "Show the mic button (on-device Whisper)" · Auto-speak replies (switch)
    "Read every reply aloud when it finishes".
  All persist via PUT /api/settings (flat object), same keys as SPEC §3.

## Component specs
- **Switch**: track `position:relative; width:38px; height:22px; border-radius:999px`; ON = `--accent`; OFF =
  `--surface` + `1px var(--line2)`. Thumb 16px circle, top3 left3, ON `translateX(16px)` + `--accentInk`,
  OFF `--tx3`. 200ms transitions.
- **Segmented button**: `padding:6px 12px; radius; 13px; font-inherit`; selected `--tx1` with accent
  underline/border, unselected `--tx3`; hover `--tx1`.
- **Pill button** (setup theme): `padding:9px 18px; radius11; 13px/500`; selected `border:1px accent; --tx1`,
  else `border:1px var(--line2); --tx2`.
- **Model picker button**: `display:flex; align-items:center; gap:12px; padding:10px 14px; radius11;
  width:100%; text-left`; selected `border:1px accent` else `border:1px var(--line2)`. Left = model id in
  JetBrains Mono 13px; right = tag in mono 11px — recommended = `--ok` "recommended", heavy = `--tx3`
  "slow on 8 GB" (>3 GB models get the warning, `llama3.2:3b` gets "recommended").
- **Icon button** (rail/composer): 36–38px square, radius12, transparent, `--tx3`; hover `--tx1` (+surface bg
  in rail). Active nav = surface bg + accent.
- Buttons/inputs: transitions 150ms; primary accent buttons hover `filter:brightness(1.08)`, active `scale(.97)`.

## ONBOARDING (First Run redesign) — first launch only, gated by `onboarded` setting
Centered column, min(480px,100%), text-center. Breathing 36px moon (margin-bottom 36px). Slide block
(min-height ~170px, `rise`): `h2` serif italic 36px title + `p` `--tx3`... actually `#9A9DAD`/`--tx2` 15px/1.7
text. Three slides (keep this exact copy):
1. "Runs entirely on your device." — "No cloud, no accounts, no data leaving this laptop. Your conversations
   live in a folder you can see — and delete."
2. "Remembers what matters. You stay in control." — "Tell Luna your preferences once and she'll remember.
   Every memory is visible, editable and deletable. Nothing is hidden."
3. "Automates your desktop, with your permission." — "Open apps, find files, organize Downloads, set
   reminders. Every action asks first — and every permission can be revoked."
**Dots** (gap8, margin 36px 0 28px): active = 22px wide accent bar, inactive = 6px dot `rgba(255,255,255,.14)`,
clickable, 250ms. Controls row: **Skip** (text `--tx3`, hidden on last slide) + primary **Continue** →
"Get started" on last slide (accent bg, accentInk, radius13, 11px 26px, 14px/600). Last "Get started" → Setup.

## SETUP (First Run redesign)
Column min(400px,100%), gap26, `rise`. 26px moon; `h2` serif italic 32px "Before we begin"; sub `--tx3`
14px "Thirty seconds. All of it stays on this device." Fields (label = uppercase 12px .08em `--tx3`, gap8):
- "What should Luna call you?" → text input placeholder "Your name".
- "Assistant name" → text input value "Luna".
- "Theme" → two pills: **Night** / **Day** (pill spec above).
- "Model" → model-picker buttons: `llama3.2:3b` (recommended, `--ok`) and `llama3.1:8b` ("slow on 8 GB",
  `--tx3`); caption `--tx3` 12px "Running on CPU with 8 GB RAM — the 3B model is the sweet spot." (Populate
  real models from /api/health; always mark 3b recommended.)
Controls: **Back** (text `--tx3`) + primary **"Start talking to Luna"** (accent) → writes settings, sets
`onboarded=true`, enters chat.

## Implementation notes (for the engineer)
- The current frontend already exists under `luna/ui/` with this structure: index.html; css/{tokens,base,
  components,layout,chat,screens}.css; js/{util,sse,state,api,markdown,router,app}.js; js/components/{toast,
  modal,shell}.js; js/screens/{onboarding,setup,chat,memory,tasks,privacy,settings}.js. READ these first.
  Reshape them to this spec — keep every fetch call, SSE handler, element hook and state field. This is a
  reskin + minor markup restructure (sidebar→rail, history→composer footer), not a rewrite of logic.
- tokens.css becomes the single source of the palette above (both themes via `[data-theme]`, accent via a
  `--accent` var set from settings). Wire the theme/accent/font-size settings to root attributes/vars.
- Preserve ALL graceful states (backend down, ollama down/model_missing, voice unavailable, image upload
  notice, empty states) — restyle them in the new language; the "can't reach her brain" screen uses the moon +
  serif heading + the exact `ollama` commands.
- Keep it offline: vendor the 3 fonts locally; no network references at runtime.
- Accessibility: visible accent focus rings on inputs/buttons; maintain contrast in Day theme; reduced-motion.
