# Contributing to Axe AI desktop

Thanks for helping. Axe AI desktop is an Electron app (Mac, Windows and Linux from one codebase) in `next/`.

## Where help is most useful

- **Windows and Linux.** Mac (Apple Silicon) is where features are built and tested. Windows and Linux bugs get
  fixed when someone reports them, so fixes from people who use those systems are very welcome.
- Bug fixes with a test that fails before and passes after.
- Small, focused improvements. For anything bigger, open an issue first so we can agree on the shape.

## Set up

You need Node 24 or newer and pnpm 10.

```bash
cd next
pnpm install --frozen-lockfile
scripts/check          # typecheck, lint and tests, one line each
```

`next/BUILD.md` explains the layout of `next/`, the design rules and how each feature works. Read the part your
change touches.

## Before you open a pull request

1. Branch from `master`. One change per pull request.
2. Run `next/scripts/check` and make sure it passes.
3. For UI changes, run `pnpm run test:e2e` and include a screenshot, light and dark.
4. Fill in the pull request template: what and why, how you tested, the risk, and how to revert.

Pull requests that touch sensitive paths (updates, sign-in, secrets, IPC, the preload bridge; the list is in
`.github/review-gate.json`) get an extra review by a maintainer.

## Style

- Plain English in the UI and in comments. Short sentences.
- Match the surrounding code: naming, comment density, idiom. Biome formats and lints (`pnpm run lint`).
- Never commit secrets, API keys or tokens. The app keeps no keys of its own: users bring their own.

## Security issues

Do not open a public issue for a vulnerability. See `SECURITY.md`.

## License

By contributing you agree that your contribution is licensed under the MIT License (`LICENSE`).
