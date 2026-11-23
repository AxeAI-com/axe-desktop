# 0002 Watching, live: the radar and live tiles

## Goal
The Watching dashboard becomes the approved "B live + Mission control" design: one radar of every watch and the
problems on top, then every other watch as a live tile, each with motion that fits what it watches, so the page feels
real-time even between checks. Same data, same actions, same design language as 0001.

Reference (Design board https://claude.ai/artifact/RTdyC21uEjjuV1X3Jn7p1X, page "Mac Watching"):
`M-WatchCombo` (the layout to build), `M-WatchBLive` (tiles and their motion), `M-WatchOrbit` (the radar). Local
copies, with exact CSS, keyframes and sizes: `/private/tmp/claude-501/-Users-demo--claude-spares-spare-t2S4wZ/9f542175-b045-438a-9da1-7bf7415a90c5/scratchpad/web-board/project/M-Watch*.dc.html`
and the generators that wrote them in `.../scratchpad/watch/` (`gen.py`, `gen_live.py`, `gen_orbit.py`, `gen_combo.py`).
Recordings of the motion: `axe-business/marketing/films/watching-live/*.mp4`. The boards use the `?mock=watchdash`
data (`lib/mock-watching-more.ts`), so that mock must look like the board when done.

Design language (0001, unchanged): warm dark palette, flat (no shadow, glow, gradient or blur), 24px containers,
999px controls, 16px media, 4/8/12/16/24/32 spacing, system font, tabular numbers, Solar Bold Duotone icons with the
.35 secondary layer, status colours only for status (ok `#7fb38a`, warning `#e0b062`, error `#e07a6a`, running brand
text `#9396ff`, paused label grey). Light theme follows the same rules with the light tokens.

## Files

### `components/watching/Dashboard.tsx` (split it: it is 917 lines; keep every file under the repo's size limit)
New pieces, one file each under `components/watching/live/`:
- `LiveDashboard.tsx` replaces the body of `Dashboard` (keep its export and props; `top` and `bottom` still render).
- `Radar.tsx`, `LiveTile.tsx`, `TileViz.tsx` (the kind-specific motion), `LiveLog.tsx`, `Odometer.tsx`, `live.css`
  (keyframes and the reduced-motion rule; import it once).
- Keep `StatusStrip`'s copy ("8 of 10 healthy, 2 need a look", the sentence under it), `LookCard`'s actions, the
  right-click menu (Check now, Pause/Resume, Delete + `DeleteDialog`), `openWatch` on click, `LivePill`, `useWidth`,
  `useMinute`. Remove `MetricCard`, the old `Section` list and the collapse state only when nothing else uses them.

### Layout (`LiveDashboard`)
1. Heading row: the status sentence (28/400, the "need a look" part in warning colour) and its line below; on the right
   a segmented control "Problems first" / "By group" (remember the choice in local storage). Problems first: problems,
   then running, then healthy, then paused, each in group order. By group: group order (`GROUPS`), problems first within
   a group.
2. Live log: a 40px pill strip (`bg-input`), label "Live log", then each watch's latest result as `dot name value`,
   newest first, scrolling sideways in a seamless loop (duplicate the list, translateX -50%, 30 s; slower if there are
   fewer than 6 entries). Pauses on hover. Hidden when there are no runs yet.
3. Grid, `repeat(4, minmax(0,1fr))` gap 16 at the wide width (`WIDE`), `repeat(2, …)` below it:
   - The radar card spans 2 columns and 2 rows (full width and 1 row when narrow).
   - Each watch that needs a look is a tile spanning 2 columns (its LookCard content: title, since, the finding text,
     the kind viz, the 24 check bars, its actions).
   - Every other watch is a 1-column tile.
   - **No empty cells.** After placing, if the last row has free cells, widen the last tiles of that row until it is
     full (write this as a pure function `fillRows(spans, cols)` in `lib/dashboard.ts` with unit tests: 10 watches with
     2 problems at 4 columns fills exactly; 9 healthy at 4 columns widens the last one; 1 watch; 0 problems).
   - With no watches at all, keep today's empty state.

### Radar (`Radar.tsx`, from `M-WatchOrbit` / the combo's smaller one: 470px square in the card, scales down to fit)
- Three rings: inner Site, middle Domain + Services, outer This Mac + Web + Other. Only rings with watches are drawn;
  the legend under it names the rings shown ("Inner ring Site" …).
- Dots spread evenly round their ring, in tile order, starting at a stable angle per watch (hash of the id) so they
  don't jump between renders. Dot colour by status; problems 14px and blinking, others 10px; running dots use brand
  text colour. Label beside each dot (name 12px, value 11px label colour), on the outer side so labels don't cross.
- The hand: a 1.5px line plus a flat wedge (`rgba(127,179,138,.07)`, no gradient), one turn every 6 s. Each dot pings
  (a ring that grows and fades) as the hand passes it: `animation-delay = angle / 360 * 6s`.
- Centre: "8/10" (28px tabular) and "2 need a look" in warning colour (or "All healthy" in ok colour).
- Hovering a tile lights its dot (ring at full opacity); clicking a dot scrolls its tile into view and gives it a
  1s highlight. Dots are buttons with an aria-label ("API health, healthy, 575 ms"); the radar has `role="img"`
  semantics only for the drawing, the dots stay focusable.

### Tiles (`LiveTile.tsx`, from `M-WatchBLive`)
- `rounded-3xl bg-card p-6`, hover `bg-raised` (200ms). Problems get a 1px inset ring `rgba(224,176,98,.35)` (error:
  `rgba(224,122,106,.35)`).
- Top row: 40px icon disc tinted by status (`rgba(status,.14)` fill, icon in status colour) with a slow ping ring;
  running watches get a spinning arc instead. Name (500, one line, ellipsis) and target (12px label, ellipsis). Right:
  on 2-column tiles a status pill (live dot + "Healthy" / "Warning" / "Down" / "Checking" / "Paused"); on 1-column tiles
  just the live dot.
- Value row: the watch's headline value (22px, 28px on 2-column; status colour unless healthy) and "when" (12px).
- The kind viz (below), then the last 24 checks as pill bars in a grid (never overflowing) with a light sweep across
  them and the newest one breathing.
- Foot: "Next check in m:ss.cc" counting down for real from the last run plus `every` (5m, 15m, 1h); "Every morning"
  for morning watches; "Paused" when paused. Problems keep their action buttons from LookCard.
- Click opens the watch (`openWatch`), right-click the existing menu. Keyboard: tiles are buttons in a grid with
  roving focus or plain tab order; Enter opens.

### Kind viz (`TileViz.tsx`); data only from the watch's real runs, facts and rows
- `health`, `uptime`, `pagespeed`: the response series as a line that scrolls left continuously (the series drawn
  twice, translateX -50%, 4 s) with a blinking dot at the end.
- `links` while checking, and any watch while `checking`: an indeterminate slider bar.
- `status`: one light per service row (6px pill), healthy ones ripple in turn, a problem blinks, unreadable ones dim;
  service names under them (11px, ellipsis).
- `outdated`: the packages from the rows as 32px pills (name, "38 to 39"), their dots pulsing in turn (max 4 shown,
  "+N more").
- `dns`: a small radar (40px) with a turning hand and "Records match" / the problem.
- `seo`: one dot per page in the sitemap (cap 60, "+N"), lighting up in a wave.
- `disk`: the used bar with a light running back and forth.
- `expiry`: the domain line under the certificate days.
- `feed`: the build file name and size, the download arrow bobbing.
- Everything else: no extra viz (the bars, dot and countdown carry it).
Numbers shown must come from the watch; never invent a value. If a watch has no runs yet, show "Waiting for the
first check" and no bars.

### Motion rules (`live.css`)
- Only `transform` and `opacity` animate (keeps it cheap). Keyframes from the board files.
- `@media (prefers-reduced-motion: reduce)`: every live animation stops; values and colours stay.
- Pause all live animations while the window is hidden or not focused for 60 s (`document.hidden`, a
  `.live-paused` class on the root that sets `animation-play-state: paused`) to save battery.
- The odometer digits (`Odometer.tsx`) are CSS columns of digits stepped with `steps()`; seed them from the real
  elapsed/remaining time when they mount and re-seed every minute (`useMinute`), no per-frame JS.
- Title bar: `LivePill` reads "Updated 0.47 s ago" with the odometer (seconds and hundredths) counting up from the
  last run.

### Docs
- `next/BUILD.md`: the Watching section describes the live dashboard; "Design rules" gets the ambient-motion rule
  (live loops only on Watching, transform/opacity only, off with reduced motion and when hidden).
- Update the Watching unit and e2e tests for the new structure; re-record the Watching screenshot baselines
  (dark and light, wide and narrow) and look at each at full size.

## Acceptance
1. `next/scripts/check` passes; `fillRows` and radar placement have unit tests.
2. With `?mock=watchdash` at 1440×900 the dashboard matches `M-WatchCombo` (same order, spans, sizes, colours,
   copy); a screenshot of it next to the board is in the PR. Also screenshots at the narrow width and in light.
3. No empty grid cell at 4 and 2 columns for 1–12 watches (unit test plus one e2e case with 9 watches).
4. Reduced motion: no element has a running animation (`getAnimations()` all paused or none) — e2e check.
5. Window hidden: animations pause (e2e or unit check of the class).
6. Every old action still works: open a watch, right-click Check now / Pause / Resume / Delete, Fix with Claude Code,
   Open status page, Details, Show packages, the empty state, the LivePill.
7. CPU: with the mock running, the renderer stays under 10% CPU on this Mac in Activity Monitor terms (measure with
   `process.getCPUUsage` or Playwright tracing over 10 s and report the number).
8. The sidebar is unchanged (0001's frozen scope).

## Out of scope
- New watch kinds, new data, the Evidence/Fix/Catalogue screens (look stays as 0001), the sidebar, main-process code.
- Security and analytics pages (a later spec).

## Stop line
Stop and report if: a kind needs data a watch doesn't have to show its viz (leave that viz out and list it); CPU stays
over 10% after keeping to transform/opacity; a file would pass the size limit after splitting; or an old action can't
be kept in the new layout.
