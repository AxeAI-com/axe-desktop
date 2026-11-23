# 0026 Pair a browser with Axe Desktop in one step

## Goal
In a desktop browser on axeai.com you pair with Axe Desktop (Mac, Windows, Linux) by one click or a
6-digit code (QR stays), and `/remote` can run Claude Code on the computer straight after.

Threat model and crypto: `docs/decisions/0003-pair-by-code-or-click.md`. Crypto is DONE and must not be
changed: `packages/contracts/src/remote-pake.ts` (+ test, vectors). Wire schemas are DONE:
`packages/contracts/src/remote.ts` (bottom: macOfferSchema … macPairStepSchema). Phone command changes
are DONE: `packages/contracts/src/remote-commands.ts` (`folders` command, `folder` on `send`,
`PhoneFolder`). axe-mac gets byte-identical copies of `remote-pake.ts`, `remote-pake.test.ts`,
`remote-pake.vectors.json`, `remote-commands.ts` in `next/src/shared/`.

## Wire protocol (both repos build exactly this)

Names: "computer" = Axe Desktop. `offer` = `MacOffer` (`newOffer`). Events go server → computer on the
existing SSE stream `GET /api/remote/connect` (computer must have sent `?key=`); the computer answers every
event with `POST /api/remote/mac/pair-step` (desktop sign-in, `macPairStepSchema`) within the timeout.

### Code
1. Computer, when the code is shown (Settings, or the "Connect a browser" sheet): `code = newPairCode()`,
   `exp = now + PAIR_CODE_MS`; `POST /api/remote/mac/pair-code {offer, expiresAt}`. When the code is used,
   expires or the screen closes: `DELETE /api/remote/mac/pair-code`. Server keeps offers in memory per
   user and key id (hub.ts), drops them at `expiresAt` (cap 2 min) and when the link detaches.
2. Browser: `GET /api/remote/pair/offers` → `PairOffers` (web sign-in, no-store). Then
   `parseOffer` + `checkOffer(offer, user.id)`; `codeStart({offer, code})`.
3. Browser: `POST /api/remote/pair/code {mac, hello}` (rate limit key `remote-pair:${userId}`, 5 per 15
   min, shared with the old `/pair`; 429 "Too many tries. Wait 15 minutes, then try again."). Server sends
   event `pair-code {id, hello}` to the link with that key id (409 `mac_offline` if none), waits 20 s, and
   returns `{reply}`. `reply: null` or timeout → 400 `code_used` "That code didn't work. Type the new code
   from your computer." Server also removes that offer (one try per code).
4. Computer on `pair-code`: if no live code → answer `reply: null`. Else BURN the code first (one try),
   then `codeRespond({offer, code, hello})`, store `{s: b64u(secret), exp: now + PAIR_CODE_MS, approved:
   true}` in `Phones.secrets`, answer `{id, reply}`. Count tries: every `pair-code` that finds a live code
   is a try; a successful pairing resets the count. After 5 tries in 15 minutes without a success, stop
   making codes and say "Too many tries. Try again in 15 minutes." Otherwise show a new code if the code
   screen is still open.
5. Browser: `secret = finish(reply)`; `qr = pairingQRFrom(offer, secret, now + PAIR_CODE_MS)`; then the
   existing `pairWithMac({qr,…})` (POST `/api/remote/phones/pair`). Computer `Phones.request`: a request
   whose secret is `approved` is allowed WITHOUT `host.ask` (typing the code was the approval); it still
   burns the secret, signs the entry and shows a notice "Chrome on Mac can now use this Mac" (OS
   notification or toast). A request that opens no live secret is answered right away with
   `{sealed: null, allowed: null}` (today it times out after 95 s); the server already maps that to 400
   `code_used`.

### One click
1. Browser: `b = await clickStart()`; `POST /api/remote/pair/request {deviceId?, commit: b.commit}`
   (rate limit `remote-pair-ask:${userId}` 5 per 15 min). The body without `commit` keeps today's
   `approve-browser` behaviour for old clients. Server picks the link (deviceId, else latest with a key id
   and events), sends event `pair-click {id, browser, commit}` (`browser` = `describeBrowser(ua)`), waits
   20 s for `click`. `click: null`/timeout → 409 "Your computer can't ask right now. Open Axe AI on it and
   try again." Server stores `pairId` (= the step id) → {userId, browser sessionId, keyId, deviceId,
   browser label}, 3 min.
2. Server returns `PairClickResult {pairId, offer, half}`. Browser: `parseOffer`, `checkOffer`;
   `r = await b.reveal(half, offer)`; show `r.check` as "123 456" with "Check your computer shows the
   same number, then press Allow there."
3. Browser: `POST /api/remote/pair/request/reveal {pairId, reveal}` (same sign-in session as step 1,
   else 404). Server sends event `pair-click-reveal {id, pairId, reveal}` to the same link, waits 95 s for
   `allowed`. Returns `{allowed}`; on false, 403 `declined` "Not allowed on your computer."
   Audit "allowed a browser" / "declined a browser".
4. Computer on `pair-click`: keep `clickRespond({offer, commit})` under `id` for 3 min (max 3 waiting;
   at most 5 click asks per 15 min, else answer `click: null`) and answer `{id, click: {half, offer}}`
   right away, without showing anything. On `pair-click-reveal`: find it by `pairId`, `open(reveal)` (a
   bad reveal → `allowed: false`, nothing shown), then ask: title "Allow {browser} to use {computer
   name}?", the check number large ("123 456"), "Press Allow only if the browser shows the same
   number.", Allow / Not me, 80 s. On Allow store `{s, exp: now + PAIR_CODE_MS, approved: true}` and
   turn on "Let my browsers and phones use this computer". Answer `{id, allowed}`.
5. Browser on `allowed: true`: `pairWithMac` with `pairingQRFrom(offer, r.secret, now + PAIR_CODE_MS)`.

### After any pairing (one pairing, one place)
- `/api/remote/phones/pair` on success also sets, on the calling session, `remote_paired_until = now +
  60 days` and new column `sessions.remote_phone` (text, nullable) = the browser's key id. Migration via
  `pnpm db:generate`.
- `pairedUntil()`/`requirePaired()`: paired when `remote_paired_until > now` AND (`remote_phone` is null
  [legacy code/approve pairing] OR a `remote_phones` row with that id exists for the user).
- `DELETE /api/remote/phones/:id` also clears `remote_paired_until`/`remote_phone` on that user's
  sessions with that `remote_phone`.
- Browser naming (`phone-keys.ts`): `deviceKind` returns "Mac", "Windows PC", "Linux PC", "Chromebook"
  for desktop UAs (not "phone"); `browserLabel` → "Chrome on Mac"; `phoneName` → "David's Mac".
  `PairedMac` stays as is (IndexedDB), so `/remote` works unchanged.

## axe-web: files
- `apps/api/src/features/remote/hub.ts`: offers map; generic `askMac(userId, keyId, event, data,
  timeoutMs)` + `resolveStep(userId, deviceId, step)`; click sessions; clear on `resetHub`/detach.
- `apps/api/src/features/remote/phone-routes.ts` / `routes.ts`: the endpoints above; `/mac/pair-code`
  POST/DELETE; `/mac/pair-step`; `/pair/offers`; `/pair/code`; `/pair/request` (+ `commit`);
  `/pair/request/reveal`; phones/pair sets the session pairing; phones delete clears it.
- `apps/api/src/features/remote/session.ts`: `pairedUntil` as above. `packages/db` schema + migration.
- API tests (existing remote route tests next to the code): code flow with a fake computer link (offer,
  `pair-code` event answered with `codeRespond`, then `phones/pair` relayed), wrong code (`reply: null`
  → 400), rate limit (6th try 429), click flow (commit → half → reveal → allowed), reveal from another
  session → 404, phones/pair success sets `remote_paired_until`/`remote_phone`, phone delete clears it,
  `requirePaired` false after delete.
- `apps/web/src/features/remote/connect-page.tsx`: title "Connect your computer" (one line under it:
  "Use Axe AI on your Mac from this browser."). Desktop browsers (no coarse pointer): first "Connect this
  browser" (one-click, shows the check number while waiting), then a 6-digit code box ("Or type the
  code from Axe AI on your computer: Settings, Browsers and phones."), then "Scan a QR code instead"
  (opens the camera view). Phones: camera first, then the code box, then the button. If the user has
  several computers showing a code, a small select picks one; one → no select. No online computer →
  "Open Axe AI on your computer and sign in" with the steps. Footer: "Only this browser gets the key.
  It never leaves it." Problems keep the existing table, plus `code_used`, `rate_limited`, `declined`.
- `apps/web/src/features/remote/phone-keys.ts`: `pairByCode({offer, code, …})`,
  `pairByClick({deviceId?, onCheck})` that end in the existing `pairWithMac`; naming fixes.
- `apps/web/src/features/remote/pair-code.tsx` (+ test): the 6-digit box (one input, numeric,
  `autocomplete="one-time-code"`, groups as "123 456", submits on the 6th digit). Old 8-character
  `PairCode` is no longer used by Settings; delete it if nothing else imports it.
- `apps/web/src/features/computers/*`: Settings → Your computers is the one place. Each computer shows
  its paired browsers and phones (from `GET /api/remote/phones` matched by key id; add `keyId` to
  `DeviceView` from the device row or the live link) with Remove, and "Connect this browser" (runs
  `pairByClick` with that deviceId and shows the check number inline) replacing "Allow this browser".
  "This browser" is marked when its key id equals the IndexedDB device key id. A link "Use a code" → `/connect`.
- `apps/web/src/features/remote/remote-page.tsx` + `use-mac-remote.ts`: new agent chats default to Ask
  (never start in Bypass/full unless picked in that chat). For a new agent chat, ask the computer
  `{type:"folders"}` and show a Folder chip (label, path in a title tooltip) picking from that list,
  default the first folder whose `agentIds` include the agent, else the first; send it as `folder`.
  Empty list → "No folders yet. Open a folder in Axe AI on your computer once." Not paired → the
  connect page content inline (button + code box), not "Connect your Mac first".
- `apps/web/e2e/`: code pairing e2e. A fake computer in the test process: a desktop sign-in for the e2e
  user (find how e2e makes sessions), the SSE stream with `?key=`, `POST /mac/pair-code`, answers
  `pair-code` with `codeRespond`, answers the `pair` event with `openPairRequest` + `makePairAnswer`
  (approved). The page types the code on `/connect` and sees "Connected to David's Mac"; Settings →
  Your computers lists "this browser". Same for one click (fake computer answers `allowed: true`).
- Docs: `docs/mobile-api.md` (new endpoints), `docs/brain/MODULES/` remote file, `DECISIONS.md` line
  pointing at 0003, `TROUBLESHOOTING.md` ("/remote says connect first after Allow this browser" → fixed).

## axe-mac: files (`next/`)
- `src/shared/remote-pake.ts`, `remote-pake.test.ts`, `remote-pake.vectors.json`, `remote-commands.ts`:
  copies (already placed); add `@noble/curves` `2.4.0` exact to `package.json` (review gate: deps).
- `src/main/remote/phones.ts`: secrets gain `approved?: boolean`; approved → no `ask`, notice instead;
  code state (current code, exp, tries); click sessions; `codeFor()` (show/rotate a code, posts
  `/mac/pair-code`), `onPairCode`, `onPairClick`, `onPairClickReveal`; unopenable request → answer
  `{sealed:null, allowed:null}` immediately. Unit tests next to the existing phones tests: code
  happy path, wrong code burns it, 5-failures cap, click happy path, bad reveal, approved secret skips
  ask, unapproved still asks.
- `src/main/remote/index.ts` / `remote.ts`: route events `pair-code`, `pair-click`, `pair-click-reveal`
  to Phones and POST `/api/remote/mac/pair-step`. The link to axeai.com is up only while remote control
  or pairing is on (review gate, 2026-11-15: nothing touches the Keychain or reaches axeai.com at launch
  otherwise). Showing a code or a QR turns pairing on; with pairing off a click finds the computer
  offline and axeai.com says to open Settings, Browsers and phones.
- `src/main/remote/phone-chat.ts`: `folders` command (recent distinct agent cwds from thread history,
  newest first, max 20, label = last path part, `agentIds`); `send` with `folder` accepted only when it's
  in that list (exact), else error "Pick a folder from the list."; no `folder` and no last folder →
  error "Pick a folder for this agent." New chats from a phone use `cmd.mode ?? "ask"`, never the
  desktop's default mode. Tests.
- Settings: the section becomes "Browsers and phones" and is always visible. Switch "Let my browsers and
  phones use this computer" (on whenever any method is used). Three ways shown: a 6-digit code ("123
  456", "Type this at axeai.com/connect. Works once, for 2 minutes.", new code on expiry), the QR (as
  today), and "Or press Connect this browser at axeai.com/connect." Paired list as today. The Allow
  dialog for clicks shows the check number.
- `docs/remote-control-SECURITY.md`: new section 17 pointing at axe-web decision 0003, and section 6's
  folder rule ("only folders from the Mac's own recent list").
- Version bump in `next/package.json` (minor) and release per `../company-mind/07-ops/deploy-release.md`.

## Acceptance
- `pnpm exec vitest run packages/contracts/src/remote-pake.test.ts` passes in axe-web; the same test
  passes in axe-mac against the same vectors file (byte-identical: `diff` the four shared files).
- axe-web `scripts/check` green; API tests above pass; e2e code-pairing and click-pairing specs pass.
- axe-mac `next/scripts/check` green; new phones/phone-chat tests pass.
- Manual: Chrome on the Mac, axeai.com/connect → type the code from Axe AI → "Connected"; `/remote` →
  new Claude Code chat with a folder from the list, mode Ask, gets an answer. Same with one click.

## Out of scope
- Phone apps (iOS/Android). The old 8-character code API stays for older desktop apps.
- Changing `remote-pairing.ts`, `remote-crypto.ts`, `remote-link*.ts` or `remote-pake.ts`.

## Stop line
Stop and report if: the crypto files need a change, a migration would touch existing rows beyond adding
the nullable column, or the server would need to see a code, a secret or a private key.
