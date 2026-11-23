# Handoff 2026-11-08: Mac app redesign (PR AxeAI-com/axe-mac#113, branch feature/home-redesign)

- **Goal:** make the Mac app calm and professional (references: Claude desktop, Raycast, Things, Arc).
- **Done (pushed, checks pass, not merged):** new home (greeting, pills, Needs you/Working/Recent), calm motion
  app-wide, quieter Watching (no live log/pill/loops, calm hover), four text colours + semibold headings,
  scrollbar-gutter on pages, Claude-style composer (controls inside the box, grey send until ready).
- **Next 1, Getting started guide** on the home, under the pills, above Activity. Pure logic in a new
  `next/src/renderer/src/lib/getting-started.ts` (+ unit test), card in `screens/NewChat.tsx`. Steps from this Mac:
  coding agent ready (`catalog.agents` state "ready" and `here`), worked in a project (agent threads with `cwd`),
  a watch exists (`watching.watches`), a connector connected (`library.connectors.connected`), local model server
  found (`catalog.servers[].found`, `catalog.local`), quick bar tried (`invoke("quick:toggle")`, key from
  `settings.quickBarKey`, mark tried in localStorage), signed in (`profile`). Actions: `openSettingsAt("clis")`,
  `pickAnswerer` + composer text, `openWatching()`, `openLibrary("connectors")`. Header "Getting started, 3 of 6
  done", thin progress bar, Hide (localStorage); hides itself when all done.
- **Also done:** UI renamed Watching to Oversight (items are "checks"; code keeps watch names); sidebar rows have no
  logos and no ellipsis; who-answers picker is in the title bar (`components/AnswererPicker.tsx`, default saved in
  `settings.answerer`); greeting is the system font 28/36 weight 500.
- **Done 2, Oversight activity timeline** (`lib/activity.ts`, `components/watching/Activity.tsx`, BUILD.md "Oversight
  activity timeline"): incidents, changes, edits and fixes as one line each; raw fix threads gone from the check page.
- **Next:** owner to look at the timeline in the app (`?mock=watchactivity` in the e2e server); then acknowledge/snooze
  from a timeline line, owners, maintenance windows, weekly PDF report. Merge PR #113 once the owner approves the look.
- **Done 3 (2026-11-08):** composer like Claude Code's (controls under the box, wand, border beam), compact menus
  everywhere, Oversight composer aligned with its tiles, the website's greeting; e2e baselines re-taken (187 pass).
- **Open:** owner to try the composer and menus in the app; the model picker (listbox) still uses the large menu
  style. Dev app runs from this worktree in the "axe-mac home" terminal tab.
