# What review looks for in the Axe AI desktop app

Read by the AI code and security reviews (`.github/review-gate.mjs`) and by people. Repo rules are
in `CLAUDE.md`; this file says what counts as a failure here.

## A change fails if it can
- Install an update that isn't ours: the updater must check the signature (`next/src/main/updates/`)
  before it replaces anything, on every platform.
- Let the renderer, a web page or a chat message reach Node, the shell or the file system beyond
  what `preload` and `ipc.ts` expose on purpose. Every IPC handler validates its input.
- Leak or mishandle a secret: the Axe sign-in token, CLI agent keys, `~/.axe-signing`. Secrets stay
  in the Keychain (`secrets.ts`), never in logs, settings files or crash reports.
- Run a command, open a file or use a macOS permission the user didn't ask for. Permissions are
  asked just in time; protected folders (Desktop, Documents, Downloads, `~/Library`) stay untouched
  unless the user asks.
- Break launch on Windows or Linux (each release must pass its launch check).
- Make the docs lie: `CLAUDE.md`, `next/BUILD.md`, or the release steps.

## Don't report
- Style, naming, formatting (Biome handles it), "consider" ideas, missing comments.
- Design choices (fonts, weights, spacing): those are decided on the design board.
- Generated files and lockfile contents (do report a risky new dependency).

## How to report
- Exact `file:line` from the diff for every finding; never a guessed file name.
- Say what goes wrong and for which input, and the fix.
- Start with a one-line summary with the count, or say "No issues."
