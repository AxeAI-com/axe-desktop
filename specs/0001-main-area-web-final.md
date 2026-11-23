# 0001 Main area on the web's final design

## Goal
Everything right of the sidebar (title bar, New chat, the thread, the composer, Watching, Settings, the library
screens, menus, sheets and the quick bar) uses the same design as the redesigned website, Axe Web "Final". The
sidebar stays pixel for pixel as it is today.

Reference: the Design board https://claude.ai/artifact/RTdyC21uEjjuV1X3Jn7p1X, page Final (`F-Welcome`,
`F-Thread`, `F-ThreadParts`, `F-Components`, `F-Cards`, `F-SettingsAll`, `F-B-*` behaviour sheets), and the web
specs 0009–0012 (axe-web PR #174, `specs/`) which the web build follows in axe-web PR #175. The rules, in short:

- **Palette, warm dark (the app's theme):** page `#161514`, surface (cards, composer, panels) `#1f1e1d`, raised /
  hover / active `#2a2928`, input fill `rgba(255,255,255,.05)`, hairline `rgba(255,255,255,.07)`, text `#f2f0ed`,
  secondary `#a19e9a`, labels `#8c8985`. Accent `#f5a25d` for badges and progress rings only, never icons. Axe Blue
  `#3438ff` only on the one main action of a view (send, sign in, the primary button of a sheet); hover `#4a4eff`;
  brand text `#9396ff`. Status: success `#7fb38a`, warning `#e0b062`, error `#e07a6a`.
- **Warm light** (kept working even though the theme switch is hidden): page `#e8e5e4`, panels `#f4f2f2`, raised
  `#ffffff`, ink `#1d1d1f`, secondary `#7a7a7e`, labels `#8a8a8e`, hairline `rgba(0,0,0,.06)`, brand `#3438ff`,
  status `#3d8a52`, `#a87414`, `#c0503f`.
- **Flat:** no gradients, no shadows, no blur in the main area. Menus, popovers and sheets are `#2a2928` (dark) /
  `#ffffff` (light) with a 1px hairline instead of a shadow.
- **Radius, two values:** 24px containers (cards, composer, panels, popovers, menus, sheets, dialogs, the dashboard
  panels), 999px every control (buttons, chips, pills, segmented tracks, inputs in panels, icon buttons, menu rows).
  Media nested in a card 16px. Avatars and logo tiles are circles.
- **Spacing** 4/8/12/16/24/32/48 only; panel padding 24; rows 12×16; controls 32 (small) / 40 (main) high.
- **Type:** keep the system font (Mac rule in `next/BUILD.md`), regular weight, 15/22 reading, 13 controls,
  12 hints, 17 titles. No middle dots in copy.
- **Icons:** Solar **Bold Duotone** (`@solar-icons/react`, already installed), 16–20px, primary layer the icon's
  colour, secondary layer the same colour at opacity .35; on hover, focus and the current item the secondary
  layer goes to 1. Brand logos stay real logos.
- **Hover and press:** 150ms ease-out: a `#2a2928` pill or row background appears, icon and label go from
  secondary to text colour, the secondary layer to 1. Press `scale(.96)` for 100ms. Current item: background on,
  secondary layer at 1. Blue buttons hover to `#4a4eff`. Extras only: the paperclip turns -8deg on hover; Search /
  Research "on" chips get `#9396ff` icon on `rgba(52,56,255,.16)`. Motion through `lib/motion.ts` with durations
  120/200/320ms and `cubic-bezier(0.23,1,0.32,1)`; reduced motion = colour and opacity only.

## Files

### Keep the sidebar exactly as it is
- `src/renderer/src/styles.css`: the sidebar shares tokens with the rest (`--ink*`, `--fill*`, `--button`,
  `--segment`, `--raised-2`, `--brand`, `--avatar*`, `--warn*`, `--line-3`, `shadow-card`, …). Add a
  `.sidebar-frozen` scope (and its light twin) that sets every token the sidebar reads back to **today's** values
  from `origin/master`, then re-value the tokens for the main area. Put `className="sidebar-frozen"` on the
  sidebar root in `components/Sidebar.tsx` (the only edit there) and on the collapsed-sidebar traffic-light strip
  if it reads tokens. `.vibrant` glass, `--sidebar*` and `--side-ink` are untouched.
- `components/Icons.tsx` stays as is for the sidebar. Its menus (`ChatMenu`, the account menu) are popovers and
  get the new menu look (they render outside the sidebar).

### Tokens and kit
- `styles.css`: the website tokens (`--background`, `--surface*`, `--popover`, `--muted-foreground`, `--border`,
  `--input`, `--hairline*`, `--brand*`, `--composer-*`, `--user-bubble`, status colours, `--elevation-overlay` →
  `none`, `--card-shadow` → `none`) and the alias layer (`--ground`, `--ink*`, `--fill*`, `--pop`, `--composer`,
  `--bubble`, `--button`, `--raised*`, `--accent*`, `--shadow`) take the palette above. `--ground` = page.
  Radius scale: `sm`/`md`/`lg`/`full` → 999 for controls; `xl`/`2xl`/`3xl` → 24; add `--radius-media: 16px`.
  The hard-coded CSS radii (`.md`, `.rich-card`, `.rich-skeleton`, tray, `--dash-*` rules) follow the same rule;
  `--card-hi` loses its gradient; the dashboard's blur and shadows go.
- `components/Kit.tsx`: `card` → `rounded-3xl bg-card hover:bg-raised` (no shadow); `button` → 40px main / 32px
  small, `rounded-full`, primary = `bg-brand` only where it is the one main action; `chip` → 32px; `Switch` keeps
  its size, knob `#f2f0ed`; `IconTile` → circle with a Solar icon; `StarterCard` → 24px radius, 24 padding;
  `RadioRow` → 40px pill, checked `bg-raised`; `Keycaps` → pill.
- `components/Library.tsx` (`Card`, `Sheet`, `Switch`, `inputClass`, `FilterChips`, tiles): same rules; `Sheet`
  `rounded-3xl bg-pop` with a hairline, no shadow.
- `components/Popover.tsx` and every menu built on it (`ChatMenu`, `ModeMenu`, `SlashMenu`, `MentionMenu`,
  `AgentOptionsMenu`, `ModelPicker`, `Select`): 24px container, 8px padding, 40px pill rows (32px in the compact
  `Select`), hairline, no shadow.
- `lib/motion.ts`: durations 120/200/320, the ease above; `card` preset drops its blur; `lift` drops the y move.

### Icons (main area)
- New `components/SolarIcons.tsx`: the main area's icons as Solar Bold Duotone components with the `.35` secondary
  layer and the hover rule (a `group`-based class or `--solar-secondary-opacity`). Same export names as
  `Icons.tsx` so screens switch by import path; the sidebar keeps importing `Icons.tsx`. Inline SVGs in
  `CommandPalette.tsx`, `Skills.tsx`, `WatchIcons.tsx`, `BoardIcons.tsx`, `watching/*` move to Solar too. Pick the
  same Solar names the web uses (axe-web `packages/ui` icons after PR #175) for the same meanings.

### Screens
- `TitleBar.tsx`: page `bg-background`, the hairline stays; menus as above.
- `screens/NewChat.tsx` (`F-Welcome`): greeting and starter cards on the new card; composer as below.
- `components/Composer.tsx` + vendored `components/ai/prompt-input.tsx` (minimal edit with `// Axe AI:`):
  composer `rounded-3xl bg-composer p-8`, no shadow or edge; send 40px round `bg-brand` (Stop: `bg-raised`);
  chips 32px pills; the paperclip rotation; Search/Research on-state tint; `ModelPicker` pill.
- `screens/Thread.tsx` (`F-Thread`, `F-ThreadParts`): user bubble `rounded-3xl bg-raised`, 15/22; action buttons
  32px round with the hover pill; scroll-to-bottom 32px round `bg-raised`; `SwitchDivider` hairline + 12px label.
  `Markdown` (`.md`): code blocks and tables 16px nested radius on `bg-card`; `StepGroup`, `rich/*`
  (`RichCard`, Chart, Table, MapCard, Choices, Draft, Visual), `Research*`, `ChangesPanel`, `DiffBlock`,
  `Cards.tsx` (`PlanCard`, `PermissionCard`, `ErrorCard`): `rounded-3xl bg-card p-6`, no shadow, pills inside.
- `screens/Watching.tsx`, `watching/*` (`Dashboard`, `Catalogue`, `Evidence`, `Fix`, `parts`, `DeleteDialog`,
  `Model`): the page in the user's screenshot. Ring and status colours from the status tokens (green
  `#7fb38a`, amber `#e0b062` for warning, error `#e07a6a`); the "Needs a look" card `rounded-3xl bg-card` with a
  1px `rgba(224,176,98,.35)` edge instead of the amber glow; history bars pill-ended; stat cards `rounded-3xl
  bg-card p-6`; numbers keep tabular figures; "Fix with Claude Code" stays the light button (it is the card's
  action, not the view's blue one); the "Live, updated" pill `bg-input`.
- `screens/Settings.tsx`, `Agents.tsx`, `Connectors.tsx`, `Skills.tsx`: on the kit; rows 12×16 in `rounded-3xl
  bg-card` groups; sheets as above.
- `screens/SignIn.tsx`: the one button `bg-brand rounded-full h-10`.
- `screens/QuickBar.tsx`, `tray/*`, `CommandPalette`, `PhoneAsk`, `Voice`: 24px containers, pills, no shadow
  (the floating quick bar keeps one `--elevation-overlay`-free hairline; macOS draws the window shadow).
- `next/BUILD.md` "Design rules": replace the flat kit paragraph's radii and colours with the rules above
  (sidebar excepted), and add a `## Web final design (2026-11-04)` note at the end.

## Acceptance
1. `next/scripts/check` passes (typecheck, lint, unit tests).
2. The sidebar is unchanged: the e2e screenshots that show the sidebar, cropped to the sidebar's box, match the
   `origin/master` baselines (0 changed pixels beyond the existing 150 tolerance), and its computed
   background, text and hover colours equal master's (assert in one new e2e test on 3 sidebar elements).
3. Computed in the running app (dark): main page background `rgb(22, 21, 20)`; composer `rgb(31, 30, 29)` with
   24px radius; a user bubble `rgb(42, 41, 40)`; a menu 24px radius and `box-shadow: none`; a hovered composer
   icon button `rgb(42, 41, 40)` and its icon's secondary layer at opacity 1.
4. `rg -n "shadow-card|shadow-\[|backdrop-blur|gradient" next/src/renderer/src --glob '!components/ai/**' --glob '!components/ui/**' --glob '!components/Sidebar.tsx'`
   prints only the macOS window/tray cases explained in the PR.
5. E2E screenshot baselines are re-recorded for every changed state (dark and light), each looked at full size
   before accepting, per `next/BUILD.md` "The gate". The PR lists which spec files changed baselines.
6. The real app runs (`pnpm run build && node tests/e2e/real-run.mjs`) and a chat with Auto answers; Watching,
   Settings and the library screens open. Screenshots of New chat, a thread, Watching and Settings in the PR.

## Out of scope
- The sidebar, its rows, its glass and its icons. The traffic lights.
- Any feature, copy or behaviour change. Main-process code. The web app.
- The behaviour sheets' new patterns (toasts, offline bar, shortcuts): a later spec.

## Stop line
Stop and report if: freezing the sidebar's tokens leaves a visible change in it you can't remove with the
`.sidebar-frozen` scope; a vendored `components/ai` file needs more than a small `// Axe AI:` edit; a Solar
icon has no fair match for an existing meaning (list them, keep the old one); any file would pass the repo's
size limit; or re-recorded baselines show a change outside the main area.
