# Building Axe desktop (next/)

The Axe AI desktop app: Electron, one build for Mac, Windows and Linux. It replaced the Swift Mac app (now on
the `archive/swift-imperium` branch) and the old Windows/Linux Electron app (`desktop/`, in git history).
Read this before you change anything in `next/`.

- Feature list and slices: https://claude.ai/artifact/WtjNaZBJ361m6j9xXxLTso
- Design board (the look to match): https://claude.ai/artifact/Rkhy1TkScLKPAd3YwxinYd

## Layout

| Where | What |
|---|---|
| `src/shared/types.ts` | Shapes shared by engine and window (Part, ChatMessage, Answerer, …) |
| `src/shared/api.ts` | The whole IPC contract: `Commands` the window calls, `Events` the engine pushes |
| `src/main/` | The engine (Node): `axe/` axeai.com client and stream, `agents/` CLI agents over ACP, `chat.ts`, `commands.ts` (every command handler), `settings.ts`, `secrets.ts`, `paths.ts` |
| `src/preload/` | Puts `window.axe` (`invoke`, `on`) on the window. Nothing else crosses |
| `src/renderer/src/` | The window (React 19, Tailwind 4, `motion`): `screens/`, `components/`, `lib/store.ts` (state), `lib/motion.ts` (the one spring and three speeds), `lib/mock-bridge.ts` (fake engine for screenshot tests), `styles.css` (colour tokens) |
| `tests/unit/` | vitest: engine and renderer logic |
| `tests/e2e/screens.spec.ts` | Playwright screenshot tests of the window on the mock bridge |
| `tests/e2e/real-run.mjs`, `agent-run.mjs` | Drive the real built app against the local server; record video and screenshots |

Adding a feature usually means: a type in `types.ts`, a command or event in `api.ts`, a handler in
`src/main/commands.ts` (or a new module it calls), state in `lib/store.ts`, UI in `components/` or
`screens/`, the mock in `lib/mock-bridge.ts`, then tests at every level below.

## Porting from the old apps

Don't rewrite what works. The old Electron app (`desktop/`, removed 2026-10-26; read it with
`git show 6da3049^:desktop/src/main/<file>`) has tested engine code for most of slices 3 and 4: `desktop/src/main/` has `agent/doit.ts` (the Do it loop on `POST /api/agent/respond`), `agent/tools.ts`,
`agent/browser.ts` + `page-script.ts` (its own browser), `apps.ts` (computer use), `terminal.ts`,
`search.ts`, `connectors.ts` (MCP), `business/runner.ts` + `store.ts` (agents and automations),
`remote.ts`, `power.ts`, `updates.ts` + `update-sig.ts`.
The Swift app is the reference for behaviour on the Mac: `App/` and `Packages/ImperiumKit/` on the
`archive/swift-imperium` branch.
Move the logic, give it this app's types and IPC, and draw it with this app's design.

## Design rules

- **Pasta UI first (since 2026-10-23).** `src/renderer/src/components/ai` (62 components) and `components/ui` are
  the website's Pasta UI copies (axe-web `apps/web/src/components/ai`, catalogue in axe-web
  `docs/design/pasta-ui/README.md`). Before building any piece, use the matching Pasta component (Schedule Card,
  Background Runs, Background Inbox, Task Card, Job Progress, Image Generation Loader, Video Player, Audio Player,
  Tool Approval, Todo List, …). Treat both folders as vendored: change them only for a real bug or a missing prop,
  with an `// Axe AI:` comment. Colours are the website's tokens (`bg-card`, `shadow-card`, `text-muted-foreground`,
  `bg-muted`, `border-border`, `bg-brand`…); the app's older names (`--ink`, `--fill`, …) are aliases, so new
  code uses the website names. Dark is the `.dark` class on `<html>`.

- **The flat kit (since 2026-10-26, board "Redesign 2/3").** Every screen is built from `components/Kit.tsx`
  and the tokens in `styles.css`: four text sizes (20 titles, 15 reading, 13 controls, 12 hints; Tailwind's
  `text-xs`…`text-2xl` map onto them), three corners (6 controls, 10 cards and menus, 16 the composer and
  sheets), regular weight only. Flat: a fill and one faint hairline (`--hairline`, `--hairline-strong`), no
  gradients, no top highlights, nothing that lifts on hover; only menus, sheets and alerts cast one small
  shadow (`--elevation-overlay`). The vendored Pasta buttons were flattened to match. A model choice is always
  the chat's picker (`ModelPicker` behind a `chip()`), a starter is always `StarterCard`.
  Dropdowns (2026-10-31): one compact look. `Select` (`components/Select.tsx`, reads `<option>`/`<optgroup>`) is a
  content-width 28 px trigger; every menu is a `Popover` of `MenuRow`s (28 px rows, 13 px, 4 px padding, radius 10,
  content width 160 to 320). `SlashMenu` and `MentionMenu` use the same sizes. Never a native `<select>`.
- Colours are tokens in `styles.css` (`--ink`, `--ink-2`, …); never hard-code a colour. Reading column 736,
  composer 768, body 15/22, system font.
- Motion only through `lib/motion.ts` (`useMotion()`): one spring, 120/240/320 ms, nothing loops,
  everything respects reduced motion.
- Real brand logos, never a letter in a square. No ' · ' middle dots in copy. Plain, short English.
- Placeholder people only in sample data and screenshots (Mia Lane, David, Jack, Sam), never the owner's name.

## The gate (every package, before its PR is ready)

```bash
pnpm install --frozen-lockfile
pnpm run typecheck && pnpm test                      # logic
AXE_E2E_PORT=<your port> pnpm run test:e2e           # screenshots, light and dark, every state
pnpm run build && node tests/e2e/real-run.mjs <out>  # the real app (see below)
```

- Each worktree uses its own `AXE_E2E_PORT` (given in your brief) so parallel runs don't share a server.
- Screenshot baselines: add new ones for every new component state, light and dark. Look at each new
  or changed PNG at full size before you accept it. Never re-save baselines without looking. Re-save with
  `pnpm exec playwright test --update-snapshots=all -g "<name>"`: plain `--update-snapshots` skips changes
  under the 150-pixel tolerance, so a small change (a logo) keeps the old baseline.
- Real-app runs need the local website on http://localhost:3000. One is usually running already (check
  with `curl -s localhost:3000`); if not, start `./dev.sh` in `~/Work/axe-business/axe-web`. Never
  start a second one. A test session cookie: in that checkout run
  `npx tsx --env-file=.env scripts/dev-desktop-session.ts` and use its `cookie` as `AXE_SELFTEST_COOKIE`
  (with `AXE_SELFTEST_ORIGIN=http://localhost:3000 AXE_HEADLESS=1`). Never print `.env` values.
- Axe models in tests: free ones only (Auto). Claude Code and Codex runs are fine and encouraged.
- Computer use and browser use are tested only on targets you create (a local page, a test window of this
  app). Never drive the owner's apps. Never kill or cover a running Axe Imperium. Run headless.
- Write a short `## <package>` note at the end of this file: what landed, how it's tested, what's left.

## Git

- Branch from `origin/master` into your own worktree under `../.worktrees/` (axeai-business).
- Commit small, push your branch, open a PR into `master`. Stage files by name. Never stash, force-push or
  push to `master` directly.
- Shared files (`types.ts`, `api.ts`, `store.ts`, `commands.ts`, `mock-bridge.ts`) are edited by several
  packages: add to them, don't reorganise them.

## Slice 1 (lead session)

- Landed: sign-in with the `axe-desktop` client (`axedesktop://`, live on axeai.com since #89), chat with
  Axe models and CLI agents, steps, sidebar, palette, themes, real brand logos (`components/BrandLogo.tsx`),
  attachments (pick, drop, paste; `src/main/attachments.ts`, `components/Attachments.tsx`), half-written
  tables held back while streaming (`lib/streaming-text.ts`), every shortcut in `lib/shortcuts.ts` (also
  listed in the palette).
- Real runs: `real-run.mjs` (free model, table, steps), `agent-run.mjs` (Claude Code edits a file),
  `attach-run.mjs` (photo and note to a free model and to Claude Code), `scripts/linux-run.sh` (the same
  real run on Linux arm64 in Docker).
- Moved to package D: the plan card's Start and Change buttons (they need plan mode).
- Open: running on Windows (no Windows machine; use a GitHub Windows runner sparingly), a signed build.

## Research, memory, usage, skills

Package B of slice 2 (branch `feat/axe-desktop-research-memory`).

- **Research** (Axe models only; hidden for CLI agents): `+ › Research`, the `/research` starter, or the chip
  that shows while it's on. The send carries `research: true` and the website runs its own flow
  (`apps/api/src/features/chat/research`). `axe/stream.ts` maps `data-research` and `data-researchApproval`
  into `research` / `researchApproval` parts (live and from history). `components/Research.tsx` draws the live
  card (bar, plan, searches, reads, writing), then folds it to "Researched for 1m 12s" over the report: title,
  summary, sections rising in as they stream, numbered citation chips (`linkNumbered` in `lib/citations.ts`)
  and the numbered sources. Paid models answer with an approval card first: Run research sends
  `trigger: "regenerate"` with `researchApproved`; Cancel PATCHes the card (`chat.ts` `approveResearch`,
  `cancelResearch`).
- **Memory**: Settings › Memory lists, adds, edits and forgets (`main/memory.ts`, one file per account in the
  data folder). axeai.com has no memory API yet, so it lives on this computer; it goes ahead of the first
  message of each Axe chat and each new agent session in a `<what-to-remember-about-me>` block that
  `stripContext` removes again. Agent chats also get `+ › Open CLAUDE.md` (or AGENTS.md / GEMINI.md, by CLI),
  which starts the file when it's missing (`agents/commands.ts`).
- **Usage ring** (`components/UsageRing.tsx`, `lib/usage.ts`), right of the docked composer. Context comes
  from the reply: Axe replies from the stream's finish metadata, sized by the window of the model you picked
  (Auto's own window for Auto); research replies count the report, not every call of the run; CLI agents
  from ACP `usage_update` (with session cost) or the prompt's token count. The popover adds plan and credits
  (Axe) or "runs on your own account" (agents). Credits refresh after every Axe reply.
- **/ menu** (`components/SlashMenu.tsx`, `lib/slash.ts`): opens while you type `/name`; arrows, Enter or Tab
  pick, Escape closes. Agent chats list the CLI's advertised commands (ACP `available_commands_update`,
  pushed as the `commands` event), then skills and command files on disk that it didn't list
  (`.claude/skills`, `.claude/commands`, `.codex/…`, `.agents/skills`, project first, then home), then Axe's
  starters. Claude Code advertises its skills itself, so they appear under its commands.
- Tests: `tests/unit/engine-slice2.test.ts` (real engine, stubbed server, fake agent now sends commands and
  usage), `research-stream`, `agent-commands`, `renderer/slice2-lib`; screenshots `research-*`, `slash-*`,
  `usage-*`, `memory-*`, `agent-instructions`, light and dark (`?mock=research`, `?mock=nomemory`); real run
  `node tests/e2e/research-memory-run.mjs next/test-results/research-memory` (free Auto research, a real
  Claude Code chat). Note `pnpm run test:e2e` empties `test-results/`, so run the real run after it.
- Left: a server memory API so the website and phones share memory (described in the PR); the 1% screenshot
  tolerance let whole new sections pass on dark screens, so changed baselines were re-saved on purpose.

## Rich replies

What landed (package A, slice 2):

- **Cards in answers.** A reply asks for one with a fenced block whose language is `axe-<kind>` and whose body is
  JSON: `axe-choices`, `axe-chart` (bar, line, area, donut), `axe-table` (sorts), `axe-map`, `axe-draft` (email or
  post, edit and copy, never sent), `axe-visual` (live HTML/SVG/canvas/WebGL). Schemas, parsing, the model hint and
  the tool mapping live in one place: `src/shared/rich.ts`. `Markdown.tsx` cuts the text with `splitRich()` and
  draws each block with `components/rich/RichBlock.tsx`. While a block streams you see its outline (a visual draws
  as it arrives, scripts held back); broken JSON, or a reply that ended inside a block, shows the plain code block.
  One-line blocks (```` ```axe-chart {...}``` ````), JSON on the fence line, trailing commas and `null` fields are
  accepted, because free models write them.
- **Website tools as cards.** `show_map` output and `draft_email` input become `{ type: "rich" }` parts in
  `src/main/axe/stream.ts` (live and stored), drawn by the same cards.
- **Choices answer for you.** Clicking an option, or pressing its number while the composer is empty, sends it as
  your next message (`sendInThread`). The card then shows the pick and locks. The thread passes `canAnswer` and
  `answeredWith` through `RichContext`.
- **Visuals are sealed.** `src/renderer/public/visual.html` runs in an iframe with `sandbox="allow-scripts"` (opaque
  origin, no popups or navigation) and its own CSP: no network of any kind, inline script and style only. The window
  posts the HTML in and gets the height back. Theme colours arrive as CSS variables.
- **Motion** is all in `lib/motion.ts`: new `card`, `draw`, `grow`, `stagger` presets and `useCountUp()`. Cards rise
  and unblur, lines draw, bars grow from the base in a stagger, donut arcs sweep, pins drop, numbers count up, hover
  readouts glide on the spring. Nothing loops; reduced motion turns it all into fades. New colour tokens:
  `--chart-1..5`, `--chart-grid`, `--map-ground`, `--map-dot`, `--card-hi` (light and dark).
- **The model hint.** Every Axe send carries `clientHints: ["rich-cards"]`; axeai.com (AxeAI-com/axe-web#90) then
  adds the card instructions to its system prompt (`apps/api/src/features/chat/rich-cards.ts` there; keep it in
  step with `shared/rich.ts`). Chats from before that carry the instructions at the end of their first message inside
  `<axe-desktop-cards>…</axe-desktop-cards>`, which `stripContext()` still hides.

Tests: `tests/unit/rich.test.ts` (splitting, schemas, partial visuals, tool mapping, titles),
`tests/unit/renderer/rich-cards.test.tsx` (numbers, ticks, map projection, table sort, choices by click and key,
streaming and fallback), `tests/e2e/rich.spec.ts` (34 screenshots on `?mock=rich`: every card done, hovered, sorted,
picked, broken, empty and streaming, light and dark; the visual's script runs in its frame). Real app:
`node tests/e2e/real-run.mjs <out> rich` asks a free Auto model for a chart and a choice, hovers, picks, and reopens
the chat from the server.

Left: maps are drawn without tiles (a quiet dotted ground, pins and route), since the window loads nothing remote;
real tiles need a decision on a tile source. Board extras not built here: weather/answer cards, source chips, image
grids and research progress (RichPlaces, RichDrafts boards). Candles on the line chart (RichData board) are not in.

## Do it

Package C of slice 3: an Axe model works on this computer from the same chat. Ported from the old app's
`desktop/src/main/agent/` and the Swift app's `ImperiumHands`, not rewritten.

- **Where:** `src/main/doit/`. `loop.ts` is the loop on `POST /api/agent/respond` (no Electron; unit tests
  drive it). `tools.ts` names and titles every tool, `guard.ts` decides what asks first, `toolbox.ts` runs
  calls, `files.ts` and `terminal.ts` are plain Node, `browser.ts` is Axe's own browser (a separate,
  sandboxed `BrowserWindow` with its own session, shown without focus; hidden under `AXE_HEADLESS`),
  `computer.ts` lists and opens apps everywhere and reads and presses inside them on the Mac through the
  `axe-hands` helper (`native/hands/main.swift`, built by `scripts/build-hands.mjs` into `resources/`, packed
  as an extra resource). `mcp.ts` + `agent-tools.ts` serve the browser and computer use to CLI agents.
- **In the chat:** the composer's + menu has "Use this computer" (`SendRequest.doIt`, a chip shows while it's
  on). `chat.ts` sends those turns to `doItTurn`, which stores them on this computer like agent turns. Every
  call is a `tool` Part (read, edit, delete, search, execute, fetch, other), `update_plan` is the plan card,
  thinking is a reasoning step, command output streams into its step, file writes and edits carry a diff.
  A follow-up right after a Do it turn continues the model's own tool history.
- **Safety:** risky steps ask with the existing PermissionCard ("Allow", "Don't allow") through
  `chat.askUser`: risky labels (send, pay, delete, submit…), form submits, Return in messaging apps, any
  command that isn't look-only, replacing, editing or deleting a file, and anything the model flags
  `irreversible`. A no becomes a `declined` step and the model is told to stop. Full access
  (`Settings.fullAccess`, Settings › Permissions, second click to turn on, window only) skips asking.
  Desktop, Documents, Downloads and Library ask every time, Full access or not, unless the user named the
  folder. Files and commands default to the workspace (`userData/Workspace`). macOS permissions are asked
  just in time: Accessibility on the first `read_screen`/`click`/`type_text`/`press_keys`, Screen Recording on
  the first `screenshot`. Self-tests never capture the screen.
- **CLI agents:** each agent session gets an MCP server entry named `axe` (HTTP on 127.0.0.1 with a Bearer
  key per chat when the agent supports it, else a stdio bridge run with this app's Node). Origin headers are
  refused and Host must be loopback. Tools: the browser and computer use (agents have their own terminal and
  files); screenshots go back as images. Risky calls ask in the chat; the agent's own permission question
  for `mcp__axe__*` is answered automatically so you're asked once. Tool rows read like Do it steps.
- **Windows and Linux:** list and open apps, screenshots, the browser, files and the terminal, as the old
  app does. Reading and pressing inside other apps is the Mac only for now.
- **Tests:** `tests/unit/doit-loop.test.ts` (fake brain and page, real temp folder: fill and stop at Send,
  no, yes, Full access, protected folders, streaming output, retries, stop), `doit-guard.test.ts`,
  `doit-mcp.test.ts` (auth, tools, images, stdio bridge). `tests/e2e/doit.spec.ts`: waiting at Send,
  finished with a declined step, the menu and chip, Full access, light and dark, plus the click-through.
  `tests/e2e/doit-run.mjs <out>`: the real app headless with the free Auto model, only on targets it makes (a
  local form it serves and counts, a temp workspace, an off-screen see-through test window): asks before
  Send, a no sends nothing, a yes sends once, a command in the temp folder, and read/type/click on the test
  window that must ask before Send. Output in `test-results/do-it/`.
- **Left:** reading and pressing inside apps on Windows and Linux (UI Automation, AT-SPI); `search_files` is
  a plain walk, not the old app's native index; Do it's browser has no window chrome or address bar yet.

## Quick bar, voice, palette

Package E of slice 4 (branch `feat/axe-desktop-everywhere`).

- **Quick bar** (`src/main/quickbar.ts`, `screens/QuickBar.tsx`, `lib/quick.ts`): a frameless, always-on-top window
  made once and kept hidden (`#quick` on the same page), shown centred a fifth of the way down the screen under
  the pointer on a global shortcut: ⌥Space on a Mac, Ctrl+Space on Windows and Linux (Alt+Space is Windows' own
  window menu). Settings › Quick bar and voice records a new key by pressing it (`shared/accelerator.ts` parses,
  shows and records accelerators; the engine refuses one another app holds). It asks the model or agent you pick in
  it (saved as `settings.answerer`, so the main window agrees; an agent reuses the folder of its newest chat, else
  asks), streams the answer with folded steps and permission cards, Enter on a finished answer (or ⌘Enter any time)
  hands the chat to the main window (`navigate` event), Esc closes a list, then a recording, then the bar. + adds the
  screen under the pointer (`desktopCapturer`; the bar has content protection so it isn't in its own shot; Screen
  Recording is asked by macOS on first use) or what's copied (text as `Copied text.txt`, or the image). The window
  follows the panel's height (`quick:resize`). It hides when you click away, except while a picker it opened is up
  (`holdOpen`). Motion: springs in from 0.965 with a 10px blur, out in 120 ms; reduced motion fades.
- **Voice** (`lib/voice.ts`, `lib/voice-logic.ts`, `components/Voice.tsx`, `src/main/voice.ts`): dictation into the
  composer or the bar (mic button; hold ⌘D to talk and let go, or tap ⌘D to start and again to stop); Talk mode
  (⇧⌘T, or the palette): an orb that grows with your voice, hears the end of a turn by a second of quiet
  (`SilenceGate`), sends it in the open chat (or a new one) with whoever answers there, reads the answer and listens
  again; mute, tap the orb to interrupt, Esc to end. The microphone is asked for the first time you use voice
  (`voice:microphone`, `systemPreferences.askForMediaAccess`), never at launch; a no shows Open Settings. Speech to
  text on macOS 26 and later happens on the Mac itself: the `axe-speech` helper (`native/speech/main.swift`, built
  with `axe-hands` by `scripts/build-hands.mjs`, shipped in Resources) runs Apple's on-device model
  (SpeechAnalyzer) on a 16 kHz mono WAV the window makes from the recording (`toWav`, `encodeWav`), in the
  system's first language. No audio leaves the Mac, no daily limit, no new permission. `voice:onDevice` says whether
  it's ready and, the first time, reserves or downloads the language's model in the background; until then, on
  older macOS, on Windows and Linux, and whenever the helper fails, it's axeai.com's `POST /api/voice/transcribe`
  (Groq Whisper, 60 a day per user). Speech out is the system's voices through `speechSynthesis` (house voice
  Daniel, like the website; Markdown made speakable, code and tables pointed at, not read). A native speaker would
  gain nothing: AVSpeechSynthesizer gives an ad-hoc-signed helper the same voices Chromium lists (the Siri and
  premium voices only reach Apple-signed programs). axeai.com has no text-to-speech endpoint; a computer with no
  voices (some Linux) shows the answer instead.
- **Palette for everything**: `lib/shortcuts.ts` is still the one table. Entries may have no key (palette only), a
  `group`, an `icon`, search `words`, `release` (hold keys) and `global` (shows the quick bar key from Settings).
  `paletteEntries()` adds every chat, every Axe model ("Answer with …", not inside agent chats), every agent ("New
  chat with …" or "Install …"); `filterPalette()` ranks and groups. Settings sections open scrolled into view
  (`openSettingsAt`). Chat actions (pin, archive, copy, stop) show only in a chat.
- Tests: `tests/unit/everywhere.test.ts` (accelerators, the Settings key, the transcribe call, the silence gate,
  speakable text, sentence chunks, voice choice, the bar's keys and folders), `tests/unit/renderer/everywhere.test.tsx`
  (palette coverage and search, dictation and hold-to-talk and Talk end to end on a fake microphone and engine);
  `tests/e2e/everywhere.spec.ts`, 46 screenshots on the mock (`?window=quick`, `&thread=` to open the bar on a chat;
  voice states set through `window.__axeVoice`): the bar empty, choosing, attached, agent, live, answered, waiting
  for a permission, dictating, signed out; dictation listening, writing, denied, done; Talk listening, thinking,
  speaking, muted, denied; the palette and Settings; plus Windows keys and reduced motion. The mic button moved the
  existing composer shots by under the 150-pixel tolerance, so those baselines were re-saved on purpose.
- Real app: `node tests/e2e/everywhere-run.mjs <out> [quick|agent|voice]` (signs in through `account:signIn`; logs
  whether speech went to the Mac or axeai.com; headless, no global key registered,
  native pickers and the clipboard stubbed, nothing audible: self-tests read answers silently). It asks free Auto from
  the bar with copied text attached and hands it to the main window, asks Claude Code to edit a file from the bar,
  dictates a `say` recording through the local server's transcription and has a Talk turn with Auto. Electron's fake
  capture device records silence on macOS, so the run feeds the recording into the window's `getUserMedia`.
  Last run's shots and video: `next/test-results/everywhere/` (not committed).
- Left: a real ⌥Space press and the screenshot capture were not exercised in the real run (they would take your key
  and your screen); a website text-to-speech endpoint for computers without voices; macOS on-device recognition
  through a native helper if we want offline dictation; Do it from the bar (board button) waits for package D.

## Libraries

Package G of slice 4 (branch `feat/axe-desktop-libraries`). Engine in `src/main/libraries/`, window in
`screens/Skills|Agents|Connectors.tsx`, shared pieces in `components/Library.tsx`, actions in `lib/libraries.ts`.

- **Skills** (`libraries/skills.ts`, starters in `src/shared/starter-skills.ts`): ten plain-English skills in the open
  SKILL.md format. Adding one writes it to Axe's own `skills/` folder and to the CLI folders you tick (`~/.claude/skills`,
  `~/.codex/skills`, `~/.gemini/skills`, `~/.agents/skills`, shown only when that CLI's folder exists). A different skill
  of the same name is never overwritten; removing deletes only copies we wrote. New skill, import a folder. Skills
  installed in Axe show in the / menu of every chat: an Axe model gets the SKILL.md instructions ahead of that
  message; a CLI gets them only when its own folders don't have the skill.
- **Agents** (`libraries/helpers.ts`, starters in `src/shared/starter-helpers.ts`; "helpers" in code, because "agents"
  already means the CLIs): instructions, who answers (an Axe model or a CLI; none means your default Axe model), skills,
  connectors, web search. Starters can be copied and changed, not deleted. "Start a chat" opens a new chat with its name
  and a chip; its instructions and skills go with the first message (or the agent session's first prompt).
- **Connectors** (`libraries/connectors.ts`, `oauth.ts`, directory in `src/shared/connectors.ts`): brands' remote MCP
  servers through `@modelcontextprotocol/sdk`. OAuth brands (Notion, Linear, Canva, Atlassian, Sentry, Vercel, Stripe,
  Intercom, Webflow, Hugging Face) sign in with discovery, dynamic registration and PKCE, the browser coming back to a
  one-shot listener on 127.0.0.1; GitHub takes a token; Slack, Figma and Asana show "Coming soon" (they only let apps
  they approved sign in). "Add your own" takes any https address or a local command. Tokens live in
  `connector-secrets.bin`, encrypted by the OS (`secrets.ts`); self-tests use a plain file in their temp data folder.
  Nothing goes to axeai.com (connectors are off there).
  - Axe models: switch connectors on per chat in the + menu (chips show them). Such turns run through the app on
    `POST /api/agent/respond` with the connector tools (`libraries/tool-turn.ts`) and live on this computer beside the
    axeai.com chat, like an agent's turn. Tools whose names don't read as reading (list, get, search…) ask first:
    Allow once, Allow in this chat, Don't allow.
  - CLI agents get every enabled connector as an MCP server in their ACP session (`SessionHandlers.mcpServers`, the
    same hook package D adds; merge by concatenating both lists). Remote ones need the agent to speak MCP over HTTP and
    carry the sign-in as a Bearer header, refreshed first.
- What each chat started with (agent, connectors, tools allowed) is `chat-meta.json`; summaries carry it.
  Every block rides in `<axe-desktop-context>`, which `stripContext` hides again.
- Composer: `/skills`, `/agents`, `/connectors` open the pages; the / menu now starts on the first name
  match (a skill whose description matches no longer steals Enter); picking a / item keeps what you typed after it.

Tests: `tests/unit/connectors.test.ts` (OAuth sign-in, MCP round trip, restart, revoked tokens, token connectors, ACP
entries, all against `tests/fixtures/fake-mcp.mjs`, a fake brand with the full OAuth flow), `tests/unit/libraries.test.ts`
(the real engine: skills into Axe and a CLI folder, a skill picked from /, agent context, an Axe model using
a connector with an approval, a CLI agent in a folder getting the connector over ACP), `renderer/libraries-lib`;
screenshots `tests/e2e/libraries.spec.ts` (21 per theme: every page, sheet, empty and waiting state, the / and + menus)
on `?mock=nolibrary` and `?mock=signin`. Every older screenshot was re-saved for the four new sidebar rows (checked by
diff that nothing else moved, except the / menus and the + menu, which gained items, and the light palette, whose old
baseline had a darker scrim than its token). Real app: `node tests/e2e/libraries-run.mjs <out>` (free Auto with a skill
and the fake connector over OAuth, Claude Code in a folder that reads a file there and calls the connector, and the
Writer agent); shots and video in `next/test-results/libraries/`.

Left: Slack, Figma and Asana need those brands to approve Axe; skills shared with a team (needs a server); plugins
(slice 5); a connector picker inside agent chats (agents get all enabled ones); the Do it loop (package D) and this
package's connector loop should become one loop with a connector toolbox once both land.

## Agent work view

Package D of slice 3 (branch `feat/axe-desktop-agent-work`): what you see and control while a CLI agent
(Claude Code, Codex, Gemini CLI over ACP) works.

- **Permission modes** (`agents/modes.ts`, `components/ModeMenu.tsx`): Ask before changes (default), Accept
  edits, Plan first, Full access, next to the composer of agent chats and on new agent chats (Shift+Tab steps
  through them). Full access shows in amber with a mark; Plan in the accent. Plan maps to the agent's own plan
  mode (`session/set_mode` "plan"). The other three keep the agent on its asking mode ("default") and this
  engine answers for you: Accept edits says yes to edits and reads, Full access to everything. That way every
  edit Claude Code makes passes through the engine first, so its file is saved before it changes (Claude Code
  edits with its own tools, not through our ACP file API). The agent's `current_mode_update` moves ours too
  (`modeFromNative`). Agents without a plan mode (Codex) are asked to plan in words, and the engine says no to
  their changes while planning. A chat's mode lives on its record (`LocalThread.mode`, `beforePlan`).
- **Plan first**: Claude Code's "Ready to code?" question (ExitPlanMode, `planRequest`) turns into the plan
  card (`parsePlan`: opening line, the steps of its longest list, the whole plan behind "Show the whole plan")
  with Start and Change the plan; the permission request carries `plan.partId` and is not drawn as a card.
  Start (`chat:startPlan`) switches to Accept edits (Full access if you had it before Plan), answers
  `exit-plan-default`, and the card becomes the to-do list (its TodoWrite updates tick it). Change answers "No,
  keep planning" and puts focus in the composer ("Say what to change in the plan"). A plan turn that ended
  without the question (or a plan in words) shows Start, which sends "Go ahead with the plan." in the new mode.
- **Review changes** (`agents/changes.ts`, `components/ChangesPanel.tsx`, `lib/changes.ts`): before the agent
  first changes a file in a turn, the engine saves it in `userData/changes/<chat>/` (bytes by hash, or "wasn't
  there"). It saves on the permission answer, on the `tool_call` that announces an edit, and on our own ACP
  writes; an edit that ran without warning is worked out from its diff (`recover`). The title bar shows "3 files
  +14 −5"; the panel lists every file that differs from before the chat's first change to it, with the diff
  (`lib/diff.ts`, long unchanged runs folded), and Keep or Undo per file and for all. Undo writes the saved copy
  back (or removes a file the agent created); Keep makes now the new starting point. Only files inside the
  chat's folder; never git.
- **Rewind** (`chat:rewindPreview`, `chat:rewind`): hover one of your messages in an agent chat, "Rewind to
  here". The card says what goes (replies, files); "Rewind chat and files" puts each file back to how it was
  before that turn, drops that message and everything after it, and closes the agent's session so the next
  message starts a fresh one with the earlier turns as context. Your message comes back to the composer. "Chat
  only" leaves files alone. The window now gives each message its id (`SendRequest.messageId`) so it can point
  at it.
- **Several agents at once** (`agents/workspace.ts`): `+ › Work in a copy` on a new agent chat. In a git repo it
  is a worktree on a new branch `axe/<title>-<id>` from HEAD (uncommitted changes are not carried over); anywhere
  else a plain copy (skips `node_modules` and build folders; refuses over 20,000 files or 1 GB). Copies live in
  `userData/copies/`. The folder chip, title bar and sidebar name the folder it came from with a branch mark.
  Deleting a chat removes its worktree only when it holds no changes and no new commits. The sidebar's
  "Working now" lists every chat working, waiting for you (amber) or done since you last looked.
- **Palette** (`lib/shortcuts.ts`): in agent chats ⌘K offers "Review changes" and "Mode: …" for each mode.
- **Notifications** (`notify.ts`, `index.ts`): when an agent needs your OK, has a plan ready, finishes or
  fails while no window of the app is focused. Clicking one brings the window forward and opens the chat
  (`openThread` event). Self-tests write them to `AXE_NOTIFY_LOG` instead of the screen.

Tests: `tests/unit/agent-work.test.ts` (18, the real engine and the fake agent, which now has Claude Code's
modes, its plan question, and edits files itself: `edit:a.txt=one;b.txt=two`, `run:<cmd>`, `slow`);
`tests/e2e/agent-work.spec.ts` (24 screenshots on `?mock=agentwork`: Working now, plan waiting, whole plan,
started, the mode menu, Full access, changes, no changes, rewind, rewound, a new chat in a copy in Plan mode,
light and dark). Existing baselines changed only for the sidebar's Working now and the mode chip. Real run:
`node tests/e2e/agent-work-run.mjs next/test-results/agent-work` (Claude Code: a plan then Start, Undo, a
rewind and a turn after it, two agents in worktrees at once, notifications).

Left: edits an agent makes through shell commands (`sed -i`, `rm`) are not saved first, so Undo and Rewind
can't restore them (Claude Code uses its own edit tools for almost everything); a rewind in a chat that also
had Axe turns leaves those on axeai.com; copies are never merged back for you (the branch is there to merge or
open a PR from); Codex and Gemini modes beyond plan-in-words weren't tried with the real CLIs.

## Updates

Package H of slice 4 (branch `feat/axe-desktop-studio-updates`). Studio, Projects and the Inbox screen left the app
on 2026-10-28; the website's `generate_image` tool shows in a chat as a plain tool step.

- **Updates** (`src/main/updates/`): `sig.ts` (feeds, versions, Ed25519 release signatures; ported from the old
  app with its own statement, `axe-desktop-release v1`, so an Imperium signature can't pass), `mac.ts` (download held
  to the signed SHA-512, unpack with ditto, check it's `com.axeai.desktop` at the feed's version, swap the bundle
  with a script after quitting), `updater.ts` (the state machine, no Electron), `index.ts` (wiring). Feed:
  `https://axeai.com/downloads/desktop` (`build.publish`). Mac: our own zip updater, because electron-updater's Mac
  path goes through Squirrel.Mac, which only installs into Developer ID-signed apps. Windows and Linux:
  electron-updater (NSIS, AppImage, .deb), `autoDownload` off; on `update-available` the release signature is
  fetched and checked first, then `downloadUpdate()`. Checks 10 s after launch and every 6 h. A ready update shows
  "Restart to update" at the foot of the sidebar and in Settings › Updates (version, state, Check now); quitting
  installs it too. Dev builds say so and never update.
- **Mac signing:** ad-hoc (`"identity": "-"`, `"hardenedRuntime": false`) until there's a Developer ID. With
  `null` nothing signed the app, the fuses step then broke the binary's linker signature, and Apple Silicon killed
  the app at launch ("Code Signature Invalid", 2026-10-23). `release:mac` ends with `codesign --verify`, so that
  can't ship again. Ad-hoc builds change identity every release, so macOS may ask for the Keychain password
  ("Axe AI Safe Storage") after an update; a Developer ID fixes that.
- Tests: `tests/unit/updates.test.ts` (versions, signatures, the whole Mac path on a local HTTP feed down to the swap,
  unsigned, tampered and wrong-app releases refused, install on quit, the Windows/Linux gate with a fake
  electron-updater); `tests/e2e/updates.spec.ts` (Restart to update and every update state, light and dark, on the
  `?update=` mock in `lib/mock-updates.ts`). Real app: `node tests/e2e/updates-run.mjs <out>`: a local feed with a
  test key and a stand-in app (Restart to update quits and the stand-in becomes 0.2.0; a bad signature is refused
  before the download).
- Hardened after an independent review: the Mac swap waits for the app to quit and swaps nothing if it is still
  running (the download waits for the next quit); update test hooks (`AXE_UPDATE_*`) only work in an unpackaged app.
- Left: Electron fuses (RunAsNode and friends) are still on, for the whole app; the first update from an unsigned Mac
  build needs the app in a folder it can write to (Applications for most people); a real signed release, Windows and
  Linux runs of the updater, and download page links for the new builds wait for the release below.

### Releasing the new app

`scripts/release <version> --notes notes.md` does all of this in one unattended run (Mac here, Windows and Linux on
GitHub at the same time, feeds published last); the notes (what changed for users, 3 to 6 lines) become the GitHub
release. `--dry-run` builds, signs and checks without publishing. The steps below are the release steps by hand.

Nothing here publishes. Steps 4 and 5 put a build in front of every user: the owner's call.

1. Raise `version` in `next/package.json` (semver; the updater compares versions).
2. Build on the release Mac: `pnpm run release:mac` (zip and dmg, arm64 and x64, plus `latest-mac.yml`). Windows
   and Linux: `pnpm run release:win`, `pnpm run release:linux` (on those systems or the old app's Docker route in
   `../desktop/scripts/build-installers.sh`), each into `next/dist`.
3. Sign: `pnpm run sign:release` (`scripts/sign-update.ts`; key `~/.axe-signing/imperium-update-ed25519.pem` or
   `AXE_UPDATE_KEY`). It writes `Axe-AI-<v>-<mac|win|linux>.sig` and checks each against the key built into the app.
4. Upload to `axeai.com/downloads/desktop/`: the builds and `.sig` files first, the `latest*.yml` feeds last.
5. Check: `curl -fsS https://axeai.com/downloads/desktop/latest-mac.yml`, then an older build shows "Restart to update".
## Remote control, keep-awake, background

Engine in `src/main/remote/` (it was `src/main/runs/` with the routine runner, which Watching v3 removed).

- **What waits** (`remote/approvals.ts`): `chat.onTurnEvent` (ask, answered, end) feeds a list of every question any
  chat asks, with its options. Answering in the chat or from axeai.com answers both; a chat that ends takes its
  questions with it. Kept in memory only. The window has no screen for it: remote control reads it and answers with
  `approvals.decide`.
- **Background**: on the Mac the app keeps running when the window closes; on Windows and Linux it stays in the tray
  while a chat works or a watch isn't paused (`keepAlive` in `remote/index.ts`). Keep-awake (`remote/power.ts`, rules
  in `shared/power.ts`): while something runs by default, plugged in, always, or off. Windows wakes for the next
  watch check (Task Scheduler, `watchesNext` in `main/watching/index.ts`).
- **Remote control** (`remote/remote.ts`): one outbound event stream to axeai.com's `/api/remote/*`; shares what
  waits and how many chats are working; does only three things: answer a waiting question, change keep-awake, ask
  you to allow a browser (7 days, a dialog here). "Run a routine" is gone: it answers "Axe can't do that remotely."
  Once per connection it sends an empty agent list (`PUT /api/automations/device/agents`), which clears the routines
  this computer used to list on axeai.com. Self-tests connect only with `AXE_REMOTE=1`.
- **Phones** (`remote/phones.ts`, `phone-chat.ts`, `link.ts`, `device-keys.ts`): `docs/remote-control-SECURITY.md`.

Tests: `tests/unit/remote.test.ts` (approvals on the real chat engine with the fake ACP agent: a no from axeai.com and
a yes, answered in the chat, not waiting; remote commands and the snapshot), `phones.test.ts`, `phone-chat.test.ts`.

## Signed-out use, composer, open-source libraries (branch fix/desktop-use-without-sign-in, local)

- **No sign-in wall.** The whole app works signed out with CLI agents; Axe's models, Studio and sync need an
  account. Signing in is a row at the bottom of the sidebar, in Settings and in the palette. New chats
  default to a ready CLI agent when signed out (`defaultAnswerer`) and to the folder of your newest agent
  chat (`draftFolder` in `lib/store.ts`). Test: `screens.spec.ts` "signed out", `tests/unit/new-chat-folder.test.ts`.
- **Composer** (`components/Composer.tsx`): + left in the box, mic right, send only when it can act
  (`PromptInput` `inline`); under the box folder, mode, chips, then the model with its logo and the context
  ring. The ASCII fox is `components/Pet.tsx`, coloured by `--pet`.
- **Open source** tab on Skills (obra/superpowers, VoltAgent/awesome-agent-skills) and Agents
  (wshobson/agents): `main/libraries/community.ts`, cached a day in `community-*.json`. Adding a skill
  downloads its folder from GitHub (one API call for the repo's tree, files from raw) and imports it;
  adding an agent copies it into your agents. Test: `tests/unit/community.test.ts` (fake GitHub),
  `libraries.spec.ts` "open source skills/agents".
- **Dev loop**: `scripts/dev-local.sh` runs against http://localhost:3000 as "Axe AI Dev" (its own bundle id,
  data folder and Keychain item), so sign-in links reach it and the installed app is untouched. Window
  edits hot-reload; engine edits restart it.

## Local models with tools

Branch `local-models-tools`.

- **Tools for local models** (`main/local-models.ts` `localBrain`): one Brain for both loops (Do it in `doit/loop.ts`,
  connectors in `libraries/tool-turn.ts`). The loops' AI SDK messages go out in OpenAI's shape (`tool_calls`, then
  `role: "tool"` with `tool_call_id`), tools as `{type: "function", function: {…}}`, temperature 0.2; streamed
  `delta.tool_calls` fragments are joined by index (or id) and each call comes out once at the end as
  `tool-input-available`. Arguments that aren't JSON come out with `inputError`: the loops run nothing and send that
  back as the call's result, so the model resends. A 400 that names tools becomes "This model can't use tools…" and
  is remembered. `doit/index.ts` `brainFor` gives a `|` id the local brain; `chat.ts` `localAnswer` sends a local
  model's turn to `doItTurn` (Do it on) or `connectorTurn` (connectors on) when it can use tools, else plain
  `localTurn`. Permission prompts and protected folders are the same code as for Axe models. Local chats still stay
  on this computer.
- **What a model can do** (`capabilities`): Ollama's `POST /api/show` (`tools`, `vision`, `thinking`), cached; other
  servers are tried. `LocalModel.tools` / `vision` feed the composer: Do it and connectors in the + menu for models
  that use tools, greyed "Not with this model" plus "This model can only chat" otherwise; a photo on a model that
  can't see says so under the box and as a "Left out" step.
- **Files** (`main/local-attachments.ts`): text inline in `<file>` blocks, the text of simple PDFs (Flate streams,
  Tj/TJ), photos as `image_url` parts for models that see, a plain note for the rest.
- **Ollama on its own**: found at `/Applications/Ollama.app`, `~/Applications/Ollama.app`, `/opt/homebrew/bin/ollama`,
  `/usr/local/bin/ollama` or `which ollama`. The app starts with `open -g -a`; the command with `ollama serve`,
  detached, `OLLAMA_HOST=127.0.0.1:11434`, `OLLAMA_KEEP_ALIVE=30m`, log in `<data>/ollama.log`; waits for
  `/api/version` (250 ms polls, 15 s). Started when a message needs it (a "Started Ollama" step), from Settings or
  the picker (Start Ollama), or when Axe opens (`settings.startOllama`). Stopped on quit only when Axe started it.
  While it's stopped its models are read from `~/.ollama/models/manifests`, so they can be picked. Get a model
  (`models:pull`, `modelPull` events) offers tool-using models that fit `os.totalmem`; picking an Ollama model warms
  it (`models:warm`, "Loading model").
- Tests: `tests/unit/local-models.test.ts` (fragments, history shape, broken JSON, no tools, the connector loop's
  resend, capabilities, the launcher on `tests/fixtures/fake-ollama.mjs`, models on disk, pull, files and PDFs),
  `local-chat.test.ts` (chat.send: Do it writes a file, asks before replacing, a connector call, a model without tools
  and a photo it can't see, Ollama started for a message and stopped). Screenshots `tests/e2e/local-models.spec.ts`
  (Ollama stopped and started, pulling, the + menu with tools, chat only, loading); `settings-models` re-saved for
  the new Ollama rows. Real app: `node tests/e2e/local-tools-run.mjs <out>` (Ollama installed and stopped,
  `qwen2.5:7b` pulled; signed out, no website needed): sending starts Ollama, Do it writes notes.txt, replacing it
  asks, a no keeps it, the fake Taskboard connector is called, quitting stops Axe's Ollama, and one you started stays.
- Left: starting llama.cpp or LM Studio (detection only); the Ollama.app start path was not run (this Mac has the
  Homebrew command only); Ollama picks the context size by memory, so a small Mac with Do it's ~20 tools may run
  short; `localModels()` (boards) only uses running servers, while the picker also lists a stopped Ollama's models.

## UI polish (2026-10-31)

- Boards are out of the app for now: no sidebar row, Dashboard or board screens, no board accounts in Settings, and
  `startPages()` no longer runs. The engine (`src/main/pages/`, `shared/pages.ts`) is still in the tree, unused;
  the screens are in git history (`git log -- next/src/renderer/src/screens/Page.tsx`).
- Light, dark and system themes work again (the Mac sidebar glass has a light tint too); colours that were fixed to dark are tokens (`--raised`, `--raised-2`,
  `--side-ink`, a soft `--button` in light).
- Text anywhere can be selected and copied (controls and the sidebar stay out of a selection); right-click has Copy,
  and Cut and Paste in fields.
- Pages are named on the title bar (name, chevron menu, one quiet line), which always ends in a hairline; no big heading
  inside a page. 200 px of room at the bottom so every page scrolls past its end. Widths (reading column 736, composer
  768) come from `lib/layout.ts`.
- The Do it chip is gone; Do it is on by default and the + menu turns it off.

## Watching v3 (in progress, branch `feat/watching-v3`)

Design and architecture: `docs/watching/design.html` (open it in a browser; every screen, light and dark, the
decisions, the delete list and the checklist). It replaces the routine-based Watching (PR #96 closes unmerged), and
the old specs.

- Landed (engine): `src/shared/watching/` (types, schedule, findings, targets, uptime rules, copy) and
  `src/main/watching/` (`store` under `<data>/watching/`, `engine`, `checks/uptime`, `index` with the
  `watching:*` commands and the `watching` event). A 30 s tick runs due watches three at a time while the Mac is
  awake and online, and once more after it wakes. Three failed runs in a row become "Couldn't reach".
- Uptime and speed (build step 2): a GET, one retry a minute later (`AXE_WATCH_RETRY_MS` shortens it in tests),
  then the full page in a hidden window on the wiped in-memory `watch-load` session (`main/watching/load.ts`, 15 s
  at most, timed until every request that started by the load event ends) for the load time and the largest files.
  Down: bad twice. Slow: above 2× the 7-day median of quiet runs and over 2 s, two runs in a row ("tell me above
  3 s" sets `fixedMs`). The slow cause names the big files that are new since the last normal run. Uptime problems
  resolve after one clean run, the rest after two; closed ones go to the thread's `past`. Snooze and That's
  expected are per finding (`watching:act`, with Undo); replies are kept in the thread (`watching:reply`). The
  first run starts after Start watching with live steps and never notifies. Notices: the watch's name as title,
  "Fix with …" and "Snooze 1 hour" on problems, "Back up after N min." when a notified problem clears.
- Page changes (`checks/page.ts`, `shared/watching/diff.ts`): loads the page, keeps its readable text in
  `<id>/memo.txt` and diffs it line by line (two lines of context, 12 shown, "N more lines"). The card's sentence
  comes from the first added and removed lines (no model); the row and the notice say "New line: “…”". Ignore
  rules on the watch: `date`, `text:<words>` (from a reply such as "ignore the date at the bottom") and
  `near:<line>` ("Ignore changes like this" remembers the changed part's heading). Validation says "not a link",
  404, a sign-in wall or no text.
- Price and stock (`checks/price.ts`, `shared/watching/price.ts`): JSON-LD Product, microdata, then Open Graph;
  the name comes from the product data. Any price or stock change is news ("Down to $42"); the card draws the
  30-day step chart from `WatchView.prices`. No price at setup offers "Watch the page instead" (switches the kind);
  a price that disappears is a failed run, then "I can’t find the price on this page anymore." as a problem.
  Not built yet: the model picking a selector for pages without structured data (needs the one-shot model call
  that free text uses, build step 5).
- Changes (page and price news) are kept in the thread (`WatchState.news`); the latest is a card, earlier ones fold
  to a line. A change you haven't opened is the row's blue dot (`unread`, cleared by `watching:seen`). Replies that
  change a watch, and Ignore changes like this, get Undo (`watching:act` with `undo`, keyed by the answer's time).
- Tests: `tests/unit/watching.test.ts` (schedule, sleep and wake, findings, targets, thresholds, retries, store,
  engine on a fake clock, replies, notices), `tests/unit/watching-page-price.test.ts` (diff, ignore rules, price
  copy, page and price in the engine). Mock: `lib/mock-watching.ts` (`?mock=nowatches` starts empty;
  `watchslow` and `watchdown` show the design's problems, `watchpage` and `watchprice` an unread change).
  Screens: `tests/e2e/watching.spec.ts` (uptime, page and price screens, light and dark).
- Removed (every row of the design's delete table): the routine runner, cloud runs, `shared/schedule.ts`, the
  `runs:*` and `watch:*` commands, the old Watching screens, cards, mocks, tests and specs. Remote control moved to
  `src/main/remote/` (see "Remote control, keep-awake, background"). Watch notices: `main/watching/notify.ts`.
- On Watching the composer is the chat's own: under the box only the model picker (no folder chip or mode menu,
  even with a CLI agent picked); the starters show while the box is focused and empty; @ lists Watches first
  (after Folders in a chat), each with its kind's icon. The new chat's fourth card is "Watch a site".
- Morning summary (`shared/watching/summary.ts`, plain templates, no model): at the time in Settings, Notifications
  (7:00, 8:00 or 9:00 am, or Off; default 8:00) and only before noon, the engine's tick sends one "Good morning"
  notification and keeps a card on top of Watching until × or noon. It covers problems opened and cleared since the
  last summary, unread news and watches that couldn't run, and says nothing when there's nothing new. It runs after
  the tick's due watches, so a summary after waking includes the catch-up runs. `/summary` shows the card now
  (this morning's window, at most a day) without moving the next one. State: `summary` in `watches.json`.
  Settings, Notifications, Watches: Off stops every watch notice and the summary's.
- Overnight and offline: no quiet hours (macOS Focus decides); offline nothing runs, and a run that ends while the
  Mac is offline is dropped, so nothing fails. The banner shows after 30 s offline (`navigator.onLine`) and goes
  when the network is back.
- Composer on Watching: the / menu lists only Watching's commands (`/check`, `/pause`, `/resume`, `/summary`; a fix
  turn adds the agent's). `/check` and `/pause` put `/pause @` in the box for the @ list; in a watch's thread they
  apply to it straight away. A message naming two or more watches replies to each and answers once under the box
  (`watchNote`). The + menu shows files, the Watch section and Connectors only. In a chat, @ a watch attaches
  `<name>.md` with its latest result and open problems.
- Quick bar: `/` lists Watch and Write. Watch puts a chip in the box; Return reads the sentence (`watching:read`,
  or `watching:draft` after "Which site?"), shows the compact plan with Start watching, then "Watching …" with Open
  and closes after 4 s. `/watch <sentence>` typed in full does the same; a plain sentence stays a question.
- Real app: `node tests/e2e/summary-quick-run.mjs <out> [light|dark]` moves the engine's clock from 2:50 to 8:00 am
  (`AXE_WATCH_CLOCK`, `AXE_WATCH_TICK_MS`, self-tests only) and covers the night's notice, the summary and its card,
  /summary, the / commands with @, the + menu, @ in a chat, the offline banner, Settings and the quick bar's /watch.
- Real app: `node tests/e2e/cleanup-run.mjs <out>` (no routine in the window, palette, bridge or data dir; the
  Watching composer with a CLI agent in light and dark; @ on both surfaces). `node tests/e2e/watching-run.mjs <out>`
  clicks through every starter. `node tests/e2e/uptime-run.mjs <out> [light|dark]` runs uptime end to end against
  a local site that is up, slow (six 6 MB photos, sent slowly) or down (502), and prints the notices it sent.
  `node tests/e2e/page-price-run.mjs <out> [light|dark]` does the same for Page changes and Price and stock
  against a local shop whose pricing text, price and stock change.

## Built-in terminal (branch `change-reading-to-thinking`)

A real shell docked under the screen: `node-pty` in `src/main/terminal.ts`, `xterm.js` in `lib/terminal.ts` and
`components/TerminalPanel.tsx` (ported from the old app). ⌘J shows or hides it (signed in); Hide keeps the shell,
✕ ends it. When a CLI agent's sign-in lapses, the error card's Sign in opens it on that CLI's login
(`signInCommand` in `agents/registry.ts`: `claude auth login`, `codex login`, else the CLI itself). pnpm drops
the execute bit on node-pty's `spawn-helper`, so `terminal.ts` restores it; `asarUnpack` keeps node-pty outside
the archive. Tests: `tests/unit/terminal.test.ts`, `tests/e2e/terminal-run.mjs` (real app, after a build).

## Agent chat polish (branch `change-reading-to-thinking`, from a recorded 20-message Claude Code run)

Review board: https://claude.ai/artifact/E1hj6ZcmUrVNJ5bC6jNe8q. What changed:
- Sent, no reply yet: "Thinking" shows under your message at once (`Thread.tsx`).
- A permission card carries its step (`PermissionRequest.toolCallId`); while it waits the step list shows no
  spinner and the asked step's row gives way to the card (`StepGroup` `asked`). The card reads "Run this
  command?" / "Write src/cart.js?", with a file icon for paths and no repeated path.
- After three questions in "Ask before changes", "Asking a lot? Let it edit files in this chat" (Accept edits).
- Answers: a unified diff draws as `DiffBlock` (per file, red/green, wrapped; `lib/diff.ts` parses it);
  plain output blocks have no "text" label or line numbers; code in table cells doesn't break mid-word.
- Changes panel: the chat keeps a 24 px gutter, the file list shows whole rows, diff lines wrap.
- The context ring's track uses `--fill-3` (it was white, invisible on light); idle agent logos in the
  sidebar are grey; an older reply's hover buttons hang into the gap, so turns sit closer.

## Model and effort for CLI agents (branch `change-reading-to-thinking`)

Agents send their own settings as ACP `configOptions`; the composer now shows the model and effort ones next to
the mode menu (`components/AgentOptionsMenu.tsx`), with the agent's own lists and names. Claude Code sends `model`
and `effort` (its levels change with the model), Codex `model` and `reasoning_effort` (only for some models).
- Engine: `agents/config.ts` picks the `model` and `thought_level` options (by id when there's no category),
  flattens grouped lists, and keeps each agent's last lists in `<data>/agent-options.json` so a chat shows them
  before its agent starts (a brand-new agent shows nothing until its first session). `session.ts` keeps
  `configOptions` and sets them (`session/set_config_option`); `chat.ts` stores picks per chat
  (`LocalThread.config`) and as the agent's default for new chats (`settings.agentConfig`), applies them model
  first before each turn, and follows `config_option_update`. Commands `agents:options`, `agents:setOption`;
  event `agentOptions`. Axe's models and the menu bar's chat show no menu. The phone has no picker; its agent
  chats start on the same defaults.
- Fixed on the way: concurrent first loads of the agent registry could cache an empty list for 10 minutes
  ("That agent isn't in the list anymore"); loads now share one fetch.
- Tests: `tests/unit/agent-options.test.ts` (lists, picks, and the real engine with the fake agent, whose
  effort follows its model), `tests/e2e/agent-options.spec.ts` (`?agentoptions`, light and dark). Real app:
  `node tests/e2e/agent-options-run.mjs <out> [light|dark]`: Claude Code on Haiku with Low says
  `claude-haiku-5-5` and reports `effort: low`, a new chat starts on Haiku, Codex switches to another model
  with low effort and answers (its own default, `gpt-5.6-sol`, fails on a ChatGPT account).

## Menu bar panel

- Landed (2026-11-01, design "Menu bar panel redesign", native, https://claude.ai/artifact/CxqMXCrfrDyjGVJR1ovwmM):
  the panel is 630 by 720 (`src/main/tray.ts`). Home (`components/tray/TrayPanel.tsx`, words in `lib/tray.ts`):
  header (mark, New chat, Open in Axe AI), **Watching** (every watch with its kind, one line, last check and a
  status dot; a row opens inline with the latest check, its facts or check rows, the last 48 checks as a strip,
  Open in Axe AI and Check now; "No watches yet" and Start a watch when there are none), **Recent chats** (the
  last 3, each with its last words), a one-line box (+ for files, the picker, the mic) and the footer (Open
  Axe AI ⌘O, Settings… ⌘,). A chat opens in the panel as before, with Back in the header. Regular weight
  everywhere (the design's semibold headers are muted 12 px instead). `tray:open` (Watching, a watch,
  Settings) closes the panel and shows the main window there; Settings goes through the new `openSettings` event.
- Tests: `tests/unit/renderer/tray-panel.test.ts`; screenshots `tests/e2e/tray.spec.ts` (home, a watch open,
  no watches, a chat), light and dark; real app `node tests/e2e/tray-run.mjs <out>` (a self-test opens the
  hidden panel through `__axeShowTray`, screenshots it and follows Start a watch and Settings…).
- One design (2026-11-01, second pass): home and a chat share the header, the field and the footer (`TrayApp` in
  `App.tsx`; `Thread panel` drops the docked composer). No separator lines anywhere, spacing only. 13 pt regular,
  11 pt section heads, 30 px rows with a hover fill, every row's content 16 px in. One glyph set: the 24 px grid,
  1.5 stroke, drawn at 16 (`ComposeGlyph` … `StopGlyph` in `Icons.tsx`, `KindIcon` at 1.5). The mark is 11 px tall
  on the name's 9 px caps, centred. The field is native: 32 px, 8 px radius, a plain fill, + and mic glyphs and
  the model as a small text pull-down. Colours: `--tray-panel`, `--tray-text-2`, `--tray-hover`, `--tray-open`,
  `--tray-field(-focus)` in `styles.css`; `html.tray` scales a chat's text, table and bubble to 13 pt.
- Closing with the icon (2026-11-01): on the Mac the panel is `type: "panel"` (a non-activating NSPanel;
  `panelType` in `src/main/tray-toggle.ts`). Electron's `show()`/`focus()` on a normal window call
  `activateIgnoringOtherApps`, which activated Axe and raised every Axe window, and hiding the panel then made
  the main window key. A panel is key without activating Axe, so the app you were in keeps focus and nothing
  else comes up. The old `app.hide()` give-back is gone (it brought a visible main window back with the next
  show). `app.on("activate")` ignores the 600 ms after a press on the icon (`trayLogic().activateShowsMain`).
  Tests: `tests/unit/tray-toggle.test.ts` (click, blur, click and the activate race on a fake clock) and
  `node tests/e2e/tray-toggle-run.mjs` (headless self-test: runs the icon's handlers through `__axeTrayClick`,
  fires `activate`, counts main-window requests). Not tried with a real click on the menu bar.
- Left: the box has no / or @ menus and no Research or Do it switches (open the app for those); the design's
  "Watching axeai.com" per-site heading (watches can be on several sites, so it says "Watching").

## Ten more Watching kinds (branch change-reading-to-thinking)

- Landed (commit 7d41970): kinds `health`, `expiry`, `dns`, `status`, `feed`, `seo`, `links`, `tests`, `outdated`,
  `disk`, behind a More chip after the five starters on Watching. Words in `shared/watching/more.ts` (labels, asks,
  plans, first messages, row lines; `cleanFolder` refuses Desktop, Documents, Downloads and Library), checks in
  `main/watching/checks/web-health.ts` (health JSON, TLS plus RDAP expiry, A/NS/MX/TXT diffs, Statuspage feeds),
  `web-site.ts` (latest*.yml and a one-byte probe of each file, robots/sitemap/llms.txt/noindex, sitemap pages one at
  a time) and `local.ts` (a folder's tests, `npm|pnpm outdated`, free space). `tests` and `links` run first after
  Start watching; health, tests, status and disk clear after one clean run. No sign-in, no model.
  `withFakeNet` (`checks/deps.ts`) now also fakes A and NS records (`a`, `ns`) for DNS in self-tests.
- Real targets (`node tests/e2e/watching-more-run.mjs [out]`, 2026-11-01): health axeai.com/api/health ok, db 1 ms;
  expiry certificate Jan 18 2027, domain Nov 7 2027; dns 2 A, 2 Cloudflare NS, 2 Hostinger MX, TXT; status GitHub,
  Groq and Infura normal, Cloudflare "Partial System Outage" (a real problem that day); feed 0.8.0 on Mac, Windows
  and Linux, all 7 files download; seo robots, 29-page sitemap and llms.txt there, no noindex; links 29/29 load
  (about 20 s); tests `npx vitest run tests/unit/watching-summary.test.ts` in this repo, 17 passed; outdated axe-web
  9 packages a major behind (pnpm); disk 382 GB free over 20 GB.
- Failing cases in the same run, on targets it makes: a local site as `lane-ceramics.test` through
  `AXE_WATCH_FAKE_NET` (health `ok:false` with `db.latencyMs` 2400 answered in 1.2 s, two problems; certificate 5
  days and domain 12 days, RDAP served locally as rdap.org; DNS whose A changes and NS go between runs, news plus
  "no NS records"; a status page in a major outage next to GitHub; a feed whose .dmg 404s; robots `Disallow: /`, no
  llms.txt and a noindex home page; a sitemap page that 500s), a temp folder whose test script exits 1 ("1 failed,
  3 passed"), a temp npm folder pinning is-number 6 (7 is out; needs the npm registry) and disk under "100000 GB".
  It saves the list and the failing health watch, light and dark, in `test-results/watching-more/`.
- Tests: `tests/unit/watching-more.test.ts`, `tests/e2e/watching-more.spec.ts` (`?mock=watchmore`, light and dark);
  the Watching empty-page baselines now show the More chip.
- Left: the composer's + menu Watch section still lists only the first five kinds (the More chip has all ten).
  OpenRouter and PostHog (also Vercel, Stripe) have no readable status feed, so they show "Not readable".

## Watching looks like New chat, and fifty greetings

- Watching is New chat's start page: `StartPage` and `StartHeading` (exported from `screens/NewChat.tsx`) draw
  the heading ("What should Axe watch?") and the cards in the middle, and the composer docked at the bottom. The
  starters are `StarterCard`s in a 3-column grid: the five main kinds and More, whose menu (the other ten) opens
  over the More card from its top. With watches, the list sits in the reading column above the dock, with the
  same cards under "Watch something new"; the pill row that showed on focus is gone. The pills stay only inside
  the "What should I watch?" reply.
- The sidebar no longer lists watches under Watching (no auto-pinned rows, no current-watch row); Watching keeps
  its problem badge and stays highlighted on a watch's screen.
- Greetings: `lib/greetings.ts` holds 50 lines (14 for a time of day, some with your first name). `pickGreeting`
  picks one per day and part of the day, so it stays put while you work. Screenshot tests fix the clock, so New
  chat says "Let's untangle it" there. Unit test: `tests/unit/renderer/greetings.test.ts`.
- Real app: `tests/e2e/watching-restyle-run.mjs` (New chat and Watching, light and dark, More lists ten, a card
  fills the composer), saved in `test-results/watching-restyle/`; `uptime-run.mjs` still creates and runs a watch
  end to end.

## Watching dashboard

- Landed (2026-11-02, design "Watching redesign", https://claude.ai/artifact/AVL5nteGWrwB1WkheQYDAo, Dashboard,
  Opened and Narrow boards): with watches, Watching is a dashboard (`components/watching/Dashboard.tsx`, numbers in
  `lib/dashboard.ts`). The status strip ("8 of 10 healthy, 2 need a look", the ring, healthy/warnings/down; paused
  watches don't count), four metric cards from real watches (health's answer time with its sparkline, else uptime's
  load time; certificate days left; disk free of the disk's size; tests passing), each hidden without its watch,
  "Needs a look" amber cards (Fix with the agent through the watch's own thread, Open status page, Show packages
  with the Opened board's table), then groups by kind: Site (uptime, health, links, feed, SEO, page), Domain (DNS,
  expiry, security), Services (status pages as pills; no feed is grey, not amber), This Mac (tests, packages, disk,
  repo), Other (price, custom). Every row has its last 24 checks (`StripTick.ms` added), "Checking" with a sweep
  while it runs (`WatchView.checking`, and the engine tells the window when a run starts). Under a heading that
  names the host, an unrenamed watch reads by kind ("Links"). Narrow (under 1000 px): one column, 2 by 2 metrics.
- Every watch is a chat: the pencil on each row and card (and a row's click) opens its thread; Esc or the back button
  in the title bar folds it into the dashboard. Sections fold from their heading, remembered per viewer in
  `localStorage` (`axe.watching.collapsed`). ⋯ on hover and right-click keep Check now, Pause, Delete.
- Kept on purpose: the composer is the chat's own (the board drew a new one); the app's title bar (Watching and a
  count, Live with the last check) instead of the board's 52 px header; the starters under the groups; the app's
  kind icons. The board's semibold headings and medium numbers are allowed only inside `.dash` (the app stays
  regular). Colours are `--dash-*` tokens (dark from the board, light on Apple's light labels); motion is CSS on
  `cubic-bezier(0.32,0.72,0,1)`, 240 to 400 ms, and the pulse, sweep and glow loops stop under Reduce Motion.
- Tests: `tests/unit/renderer/watching-dashboard.test.ts`; screenshots `dash-wide`, `dash-narrow`, `dash-opened`,
  `dash-collapsed` in `tests/e2e/watching.spec.ts` (`?mock=watchdash`, ten watches like an owner's), light and dark;
  rows are found by `row-<id>`. Real app: `node tests/e2e/watching-dashboard-run.mjs <out>` creates the ten watches on
  axeai.com and this Mac through `watching:draft`/`create`, runs them, screenshots light, dark, wide and narrow, opens
  a watch with the pencil, folds it with Esc and Back, folds Domain across a reload and checks the menu bar panel
  lists all ten (2026-11-02: 8 of 10 healthy; Cloudflare's real outage and 4 packages behind in next).
- Left: the tests watch in the run uses one quick test file, not the whole axe-web suite (minutes, needs its
  database).

## Available elements

- Design: "Watching redesign" (https://claude.ai/artifact/AVL5nteGWrwB1WkheQYDAo), Elements board. The old "Watch
  something new" grid (five starters and More) is gone: the empty Watching page and the foot of the dashboard both
  show the catalogue (`components/watching/Catalogue.tsx`): "Available elements", then This Mac (11), Web (8) and
  "Sites, services and code" (the 16 older kinds with Custom, same card, no preview; Custom puts "Tell me when " in the composer for the model to read). Cards are the board's: 12 px corners, 16 px
  padding, a 32 px tile with the 16 px glyph at stroke 2.25, Recommended chip, + button, two-line note, a 72 px
  preview. Previews show the card's shape with grey bars where numbers go, never sample values. Four columns from
  900 px, two from 440. `.dash-el` in `styles.css` (hover fill, press scale, focus ring, no motion under Reduce
  Motion). Kept on purpose: no 52 px header or Close (it's part of the page), no "axeai.com" chip by Web, and no
  " · " in previews (the board's placeholders used it).
- Add (`addElement` in `lib/watching.ts`) starts the watch's chat the same way a starter did: kinds that need nothing
  (processes, memory, battery, Docker, Homebrew, macOS updates, Time Machine, network, fees) draft straight away and
  open the plan, or say under the composer why they can't run here ("Time Machine has no backup disk set up",
  "Docker isn't running", "This Mac has no battery"). The rest put their question in the composer (`ELEMENT_ASK`);
  Dev servers also lists what's listening now. Competitor pages is Page changes with its own question
  (`watchHint`). The model reading free text knows every new kind (`READ_SYSTEM`).
- Kinds and words: `shared/watching/elements.ts` (labels, schedules, asks, targets, names, sentences, plans, the
  catalogue). Checks: `main/watching/checks/mac.ts` (ps, sysctl and memory_pressure, ioreg and pmset, lsof, docker,
  git status plus `git ls-remote` (asks the remote without fetching), `brew outdated` without auto-update,
  softwareupdate, tmutil, du, system_profiler, scutil, networkQuality once a day) and `checks/web-elements.ts`.
  Every source is keyless and nothing is billed to Axe: public RPCs (mainnet.base.org, ethereum-rpc.publicnode.com,
  api.mainnet-beta.solana.com, api.trongrid.io), Coinbase's spot price, Hacker News search on Algolia, Reddit's
  search feed (RSS, honest user agent, through the app's Chromium network stack), DNS blacklists over DNS (5 s each, an unanswered list counts as
  "couldn't ask", never clean), Globalping's free probes (250 tests an hour), GitHub's release API (60 calls an
  hour), api.ipify.org for the public IP, and a hidden window on this Mac for page vitals (`vitals` in `load.ts`).
- What each measures, honestly: Page speed is lab LCP, CLS and first byte from one cold load on this Mac (PageSpeed
  Insights answers 429 without a key, and INP needs real visitors, so neither is used). Desktop downloads is GitHub
  release download counts; your own server's logs aren't public, so a feed link is refused with that reason (watch
  the update feed instead). Wallets count a payment as a balance that went up since the last check (USDC and USDT;
  Base and Ethereum for 0x addresses, Solana, Tron USDT). Fees are one USDC transfer (65,000 gas; Solana's 5,000
  lamports plus the median priority fee on 200,000 compute units), Base without its L1 data fee. Homebrew can't
  mark security fixes, so the card doesn't claim to. Git "behind" means the remote has commits this clone doesn't
  (no fetch, so no count); a branch never pushed counts as unpushed. Disk hogs measures your home's own folders and
  never Desktop, Documents, Downloads, Library, Movies, Music, Pictures or the Trash unless you name them.
- Reddit, honestly: its JSON search answers 403 ("blocked by network security") to apps without an account and its
  RSS feed 429s after a call or two; on this Mac the DNS (Tailscale and the ISP) also answers 127.0.0.1 for
  reddit.com. Axe never poses as a browser, so the card says "Couldn’t ask: Reddit refused; it blocks most apps
  without an account" (or "blocked on this network") and Hacker News still works. Making Reddit reliable needs the
  user's own Reddit app key or their own browser: not built yet.
- Dashboard: This Mac kinds are cards in This Mac; Page speed and Global response in Site; Email in Domain; wallets,
  fees, mentions and downloads in a new Web group (cards when wide). Mock: `?mock=watchelements`
  (`lib/mock-watching-elements.ts`, values from a real run, placeholder names and address).
- Tests: `tests/unit/watching-elements.test.ts` (every parser on real output, hogs, payments, blacklists, the words of
  every kind); `tests/e2e/watching-elements.spec.ts` (`el-catalogue`, `el-add-memory`, `el-ask-ports`, `el-dash`,
  `el-dash-catalogue`, light and dark). Starter clicks in older specs and runs now click `Add <kind>` in the
  catalogue. Real app: `node tests/e2e/watching-elements-run.mjs <out>` (hidden, own data folder): every element on a
  real target, then the failing cases it sets up (a CPU burner held 11 minutes on the self-test clock, a server and a
  container that stop, a clone left behind, a folder that grows, limits nothing meets, a picture that shows after
  5 s, a mail server on 127.0.0.2, a private repo).
- Real run 2026-11-02, 25 of 25 (`test-results/watching-elements/results.txt`): Docker 4 running, 2 stopped, 68 GB;
  Homebrew 66 outdated; macOS 27.2 and Command Line Tools pending; battery 83% after 217 cycles; home's biggest
  folder ~/.colima 55.9 GB (160 s to measure); 357 Mbps on Wi-Fi with Tailscale; axeai.com LCP 1.3 s, CLS 0.00;
  0 blacklists (6 answered); 58 to 876 ms from three regions; fees under a cent; Time Machine refused honestly
  (no backup disk on this Mac); Reddit refused. Every failing case turned into a problem or a plain refusal.
