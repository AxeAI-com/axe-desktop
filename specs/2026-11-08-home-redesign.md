# 2026-11-08 Home redesign (New chat)

## Goal
Make New chat look and work like a calm, professional home, in the spirit of Claude's desktop app, Raycast,
Things and Arc: one quiet greeting, the composer high on the page, suggestions as small pills, and a list
of the work that is waiting, running or recent.

## Design
- **Greeting (Claude):** one line, "Good morning/afternoon/evening, {first name}", in the app's own sans,
  regular, the Axe mark the same height as the text. No rotating lines. (A serif was tried and dropped.)
- **Composer:** directly under the greeting, about a fifth of the way down the page, not docked at the bottom.
  No pet on it.
- **Suggestions (Claude):** the four picks from `lib/suggestions` as 32 px pills under the composer: icon
  plus title, no notes, no coloured tiles.
- **Activity (Things and Raycast):** under the pills, only when there is something to show. Three short
  sections, each a 12 px label and 38 px rows (icon, title, right-hand status or time):
  - *Needs you*: chats waiting for an OK, and watches with open problems.
  - *Working*: chats running now.
  - *Recent* was removed on 2026-11-08 (the sidebar lists your chats); a Getting started card sits above Needs you.
  Rows open the chat or the watch. Nothing on this list is decorative.
- Flat, the kit's tokens, no new colours. Warn colour only on "Needs your OK" and watch problems.

## Files
- `next/src/renderer/src/screens/NewChat.tsx`: new layout, pills and activity list.
- `next/src/renderer/src/lib/greetings.ts`: one time-of-day line instead of fifty.
- `next/src/renderer/src/lib/home.ts` (new): pure function that builds the activity sections.
- `next/src/renderer/src/components/Composer.tsx`: drop the fox.
- `next/src/renderer/src/App.tsx`: drop the forest.
- Delete `components/Pet.tsx`, `components/Forest.tsx`, their tokens and `tests/unit/forest.test.ts`.
- Tests: `tests/unit/renderer/greetings.test.ts`, new `tests/unit/renderer/home.test.ts`.

## Acceptance
1. New chat shows the greeting, the composer under it, pills, and the activity list when there are chats.
2. A chat waiting for permission is under Needs you; a running one under Working; idle chats are not listed.
3. A watch with live problems is under Needs you and opens that watch.
4. No fox or forest anywhere.
5. `next/scripts/check` passes.

## Out of scope
- Sidebar, Watching, Customize, threads, the quick bar and the tray.

## Stop line
Stop and report if the composer's start variant can't sit mid-page without changing other screens.
