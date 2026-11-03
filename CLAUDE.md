# Axe AI desktop (AxeAI-com/axe-mac)

The Axe AI desktop app: Electron, one codebase for Mac, Windows and Linux, in `next/`. Chat with Axe models
and CLI agents (Claude Code, Codex, Gemini CLI, local models), Do it (computer use, its own browser, file
search), Boards, menu bar chat. Mac (Apple Silicon) is where features are built and tested; Windows and
Linux ship from the same code every release and are fixed only when a release check fails or a user
reports a bug .

Default branch: `master`. Server: AxeAI-com/axe-web.

## History

- The native Swift app (Axe Imperium: `App/`, `Packages/ImperiumKit`, the Xcode project, `scripts/`,
  `design/`, `PLAN.md`) was removed from `master` on 2026-10-26. It lives on the branch
  `archive/swift-imperium` and the tag `swift-final`. It gets no new work.
- The old Windows/Linux Electron app (`desktop/`) was removed on 2026-10-26; it is in git history.

## Where to read

| File | What |
|---|---|
| `next/BUILD.md` | Layout of `next/`, the gate before a PR, design rules, how each feature works |
| `docs/remote-control-SECURITY.md` | Threat model for remote control from axeai.com |

## Top commands

```bash
cd next && pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run lint && pnpm test   # what PR checks run
cd next && pnpm test:e2e                                # the real Electron app (Playwright); local only
cd next && scripts/dev-local.sh                         # run against the local axe-web
cd next && pnpm run release:mac && pnpm run sign:release   # release only
```

## Working lean
- Run `next/scripts/check` (quiet; `--no-test` skips tests) instead of separate typecheck, lint and test commands.
- Specs live in `specs/` (`TEMPLATE.md`), one file per task.
- Subagents in `.claude/agents/`: implementer (builds from a spec), reviewer (diff only), explorer (where/how).
- Cap output with `| tail`.
- One task per session.
- Review gate uses sonnet by default; add `--deep` for opus.

## Rules that bite

- Work in your own worktree (`git worktree add -b <branch> ../.worktrees/<name> origin/master`). Other
  sessions share the main checkout: stage files by name, never stash, reset or switch its branch.
- Every release raises the version in `next/package.json`; the updater compares versions.
- Any always-on-top window must pass `skipTransformProcessType: true`, or the app leaves the Dock and ⌘Tab.
- **Permissions:** nothing is asked at launch; every macOS permission is asked just in time. Never touch
  protected folders (Desktop, Documents, Downloads, `~/Library`) unless the user asks.
- **Design:** system font, regular weight, no ' · ' middle dots in copy, real brand logos.
- **Testing:** don't kill or cover a running Axe AI app; test runs use their own `--user-data-dir`.
- **Secrets:** never print, copy or commit anything from `~/.axe-signing` or `.env` files. Name secrets,
  never quote their values.
- **Review gate (2026-10-27):** a PR touching a path in `.github/review-gate.json` (updater, sign-in,
  secrets, IPC and preload, shell env, update signing, dependencies, workflows) needs a clean
  `node .github/review-gate.mjs review <pr>` (AI code and security review) before it merges; the "Review gate"
  check reads its comment. What counts as a failure: `REVIEW.md`. PRs fill in Testing, Risk and How to revert.
- No paid GitHub features. PR checks (typecheck, lint, unit tests) and the supply-chain audit run for
  `next/` on GitHub-hosted runners; end-to-end tests stay a local check.
