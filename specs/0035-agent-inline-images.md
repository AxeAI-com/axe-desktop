# 0035 Pictures an agent makes show in the chat

## Goal
When a CLI agent (Claude Code, Codex, Gemini CLI) writes or reads a picture, or sends one as an ACP image
block, the picture shows inline in its reply on the Mac and in the same computer chat on axeai.com, so
"show it here" never needs an outside site or a file in Downloads.

## How it works
- **What counts.** A tool call that finishes (`completed`) and names an image file: its locations, the
  path in its input (`toolPaths`), and for a command (`execute`) any word in the command ending in
  `.png .jpg .jpeg .gif .webp .svg` that exists afterwards and changed during this turn. Also ACP `image`
  content blocks, in `agent_message_chunk` or in a tool call's `content`.
- **The copy.** The Mac reads the file once, checks the first bytes really are that kind of picture (SVG:
  text with an `<svg` element), and saves a copy in its own data folder:
  `<userData>/agent-images/<sha256(threadId)[:32]>/<partId>.<ext>`. Nothing is written anywhere else. The
  copy is what both the Mac and axeai.com show, so later edits or deletes of the agent's file don't
  change what the chat showed. Deleting the chat deletes its folder.
- **Where it may read.** Files inside the chat's folder, the agent's own temp folders, and anything else
  except macOS's protected folders (Desktop, Documents, Downloads, `~/Library`, iCloud Drive), which are
  read only when the chat's folder is inside them. Axe never triggers a permission prompt for a picture.
- **Limits.** 10 MB per picture, 12 pictures per reply. A file written twice in one reply keeps one
  picture, refreshed (`rev` goes up), placed after the first tool that made it.
- **The part.** `{ type: "image"; id; name; mime; size; rev?; width?; height? }` in `shared/types.ts`.
  No path and no bytes in the part, so chat files and the phone's `read` stay small and don't carry the
  folder layout.
- **Mac window.** `chat:image (threadId, partId)` returns a data URL, only for an image part in that
  chat's messages (saved or still streaming); anything else is refused. The reply shows it at its own
  size, at most 100% of the column wide and 420 px tall, rounded, with its name as alt text. SVG is shown
  only through `<img>` (no scripts run there).
- **Phone link.** New closed-list command `image {chat, part, index}` in `remote-commands.ts` (both repos,
  identical). The Mac answers with `{ mime, size, total, data }` for piece `index` (96 KB before base64,
  the same as `upload`). It serves only an image part that is in that chat's messages, read from Axe's own
  copy by part id: the phone never names a path. Pieces have their own budget (200 per 10 s per phone)
  instead of the 40-command limit. Threat model section 6 and a new build note list it.
- **axeai.com.** `mac-messages.ts` maps `image` to a `data-macImage` part `{ chat, part, name, mime, size,
  rev }` (added to `ChatDataParts`). The thread draws it with `MacImage`, which fetches the pieces through
  `useMac().image()`, builds a Blob of the Mac's declared type (only the five image types) and shows it
  with `<img>` from a blob URL, kept per `chat:part:rev` so scrolling doesn't fetch twice. Max 100% wide,
  420 px tall (320 px on phones). While loading: a quiet box at a fixed height; offline or refused: the
  name in muted text.

## Files
- `axe-mac/next/src/shared/types.ts`: the `image` Part.
- `axe-mac/next/src/main/agents/images.ts` (new): what counts, where it may read, sniffing, the store.
- `axe-mac/next/src/main/agents/updates.ts`: `ReplyBuilder.image()` and ACP image blocks.
- `axe-mac/next/src/main/chat.ts`: capture on finished tool calls, wait for captures before the turn
  ends, `imageFor()`, delete the folder with the chat.
- `axe-mac/next/src/shared/api.ts`, `src/main/commands.ts`, renderer `mock-bridge.ts`: `chat:image`.
- `axe-mac/next/src/renderer/src/lib/steps.ts`, `screens/Thread.tsx`, a small `AgentImage` component.
- `axe-mac/next/src/shared/remote-commands.ts`, `src/main/remote/phone-chat.ts`, `remote/index.ts`: `image`.
- `axe-mac/docs/remote-control-SECURITY.md`: section 6 row and build note.
- `axe-web/packages/contracts/src/remote-commands.ts` (same file), `chat-attachments.ts` (`macImage`).
- `axe-web/apps/web/src/features/remote/*`: `image()` on the session, `MacPart` fields.
- `axe-web/apps/web/src/features/chat/mac-messages.ts`, `message.tsx`, new `mac-image.tsx`.
- Tests next to each.

## Acceptance
1. A finished Write of `glass.svg` in the chat's folder adds one `image` part after that tool; its copy is
   in `agent-images/`, and the agent's file is untouched.
2. A finished tool naming `~/Downloads/x.png` from a chat whose folder is elsewhere adds nothing and the
   file is never opened.
3. A `.png` that is really text, a file over 10 MB, or a 13th picture adds nothing.
4. An ACP image block (message or tool content) becomes an image part.
5. `chat:image` and the phone's `image` refuse a part id that isn't an image in that chat, a chat that
   doesn't exist, and an index past the end; they never take a path.
6. Pieces put back together on axeai.com are the copy's bytes; the thread shows the picture.
7. `next/scripts/check` and axe-web `scripts/check` pass.

## Out of scope
- Showing pictures from Axe models or local models (they have their own paths).
- Opening the picture full size, saving it, or "Show in Finder".
- Video, PDF and other files.
- Images in a reply that was rewound away keep their copy until the chat is deleted.

## Stop line
Stop and report if: the change needs `src/preload/` or `src/main/ipc.ts`; the phone would have to name a
path; or the agent's own files would have to be moved or written.
