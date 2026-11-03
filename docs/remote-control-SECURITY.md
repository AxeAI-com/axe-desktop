# Remote control: threat model

Signed off by the maintainer on 2026-10-26 (decisions in section 11). Covers the Axe AI desktop app
(`axe-mac/next`, Electron) and axeai.com (`axe-web`: the web app and the relay in the API).

The design is the board page "Remote control" (artboards RCSettings, RCScan, RCAllow, RCPhoneChat,
RCConnected, RCSecurity). It replaces an earlier, heavier draft, which the maintainer overruled
on 2026-10-26:

- No passkeys, no Face ID, no daily re-checks, no 6-digit match codes. QR pairing plus one Allow on the Mac.
- No Ask-mode lock and no "risky steps wait at the Mac". The phone may use any mode, Bypass included.
- Security goes into making pairing unforgeable, not into friction afterwards.

## 1. The promise

Only two things can drive your Mac: **you at the Mac**, and **a phone you scanned and allowed**.
Axe's server is a mailbox. It passes sealed boxes on and can't open, change, replay or invent them, and it
can't add a phone.

## 2. What we protect

| Asset | Why it matters |
|---|---|
| The right to send commands to the Mac's agents | In Bypass an agent can run anything as you. This is the crown jewel. |
| Chat content in transit (prompts, replies, tool output, attachments) | Code, secrets, customer data |
| The list of allowed phones | Whoever can add to it owns the Mac |
| The Mac's device keys and each phone's keys | They are what "allowed" means |
| Availability | A dead link is annoying, not dangerous. It must never fail open. |

## 3. Who is in the picture

```
Phone browser (axeai.com)  ⇄  Axe relay (axe-web API)  ⇄  Axe desktop on the Mac  ⇄  CLI agent / Axe models
        └────────────── sealed end to end (AES-256-GCM) ──────────────┘
          TLS on each hop as well
```

Trusted: the Mac while you're signed in to macOS, and the phone while it's unlocked.
Not trusted: Axe's server, the network, anything that reaches the relay, any QR you didn't see on your own Mac.
Trusted with a known limit: the web page's code (section 7, T10).

## 4. Keys and pairing

### Keys

| Where | Keys | Stored |
|---|---|---|
| Mac | Ed25519 (signs) and X25519 (key agreement), made on first use | Private halves sealed with Electron `safeStorage` (macOS Keychain). Never leave the Mac. |
| Phone | Ed25519 and X25519 through WebCrypto, `extractable: false` | IndexedDB on axeai.com. Page code can use them but can't read them out. Needs WebCrypto Ed25519/X25519 (Safari 17+, Chrome 133+, Firefox 130+). |
| Allowed phones list | One entry per phone: phone id, its public keys, name, added time, signed by the Mac's Ed25519 key | On the Mac. The server keeps the phone ids only, for routing and Remove. |

### The QR

Settings → "Use from your phone" shows a QR with:

`axe-rc:v1`, the Mac's device id, the Mac's public keys (Ed25519, X25519), a pairing secret `s` (32 random
bytes), the expiry, and `accountTag`, a hash of your Axe user id and the Mac's id (so the phone can check it's your account
without the QR naming you).

- A new QR every 2 minutes. Each `s` works once. The Mac forgets `s` when the QR changes or is used.
- `s` is never sent to the server. It travels only by light, from the Mac's screen to the phone's camera.

### Pairing, step by step

1. The phone scans the QR on axeai.com ("Connect your Mac"). It checks `accountTag` against the account
   it's signed in to and the expiry. Wrong account: "This code is for a different Axe account." Nothing is
   sent.
2. The phone makes (or reuses) its own key pair, then sends a **pairing request** through the relay:
   its public keys, its name ("David's iPhone", "Safari on iPhone"), and a MAC over all of that and the
   Mac's public keys, keyed by `s`. The whole request is sealed to the Mac's X25519 key from the QR.
3. The relay passes it on only to that Mac id, only within the same account, and rate limits it.
4. The Mac opens it, checks the MAC with the current `s` and burns `s`. If anything fails it drops the
   request silently, with no dialog.
5. The Mac asks once: **"Connect David's iPhone?"** (Safari on iPhone, just now) with **Allow** and
   **Not me**. 80 seconds, then no.
6. On Allow, the Mac signs the phone into its list and sends back a sealed confirmation, MAC'd with `s`, so
   the phone knows it reached the real Mac. The phone pins the Mac's public keys from the QR.

**Why no match codes are needed.** A 6-digit code exists to stop a server swapping keys during an exchange
it carries. Here the Mac's key reaches the phone through the camera, not through the server, and the
phone's key reaches the Mac bound to `s`, which the server never sees. A server that swaps either key fails
the MAC. That is why we can drop the code without losing anything: it's the same reason WhatsApp and Signal
desktop linking use a QR without a code.

## 5. The link

- **Two outbound WebSockets** to the relay in the axe-web API: one from the Mac, one from the phone. No
  open ports on the Mac. They replace today's event stream plus POSTs (`remote/remote.ts`,
  `features/remote/hub.ts`).
- **Tokens, single purpose and short:**
  - Mac: a one-use ticket, 30 seconds, for the Mac side of the relay only. To get one the Mac signs the
    account id and the time with its device key, so a copied desktop sign-in alone can't open its socket.
  - Phone: a one-use ticket, 30 seconds, for one paired phone and one Mac, minted from the web sign-in.
  - Both are sent as the first message after the socket opens, never in the URL (URLs end up in logs). No
    ticket within 5 seconds closes the socket.
- **A fresh handshake on every connection.** Both sides send a new X25519 key, signed with their device
  Ed25519 key. Each checks the other's signature against the pinned key (the Mac also checks its signed
  list). HKDF-SHA256 over both shared secrets and the transcript gives two keys, one per direction. Old
  traffic stays safe if a device key leaks later (forward secrecy). This is the SIGMA pattern; we don't
  invent a primitive.
- **Every frame:** AES-256-GCM. The nonce is the direction plus a 64-bit counter, so it never repeats under
  one key. The authenticated data covers protocol version, direction, Mac id, phone id, connection id,
  sequence number and chat id. The receiver accepts only `seq == last + 1`. A replayed, reordered, cut or
  changed frame fails and is dropped, and two failures close the link.
- **New keys** on every reconnect, and after 1 hour or 2^24 frames, whichever comes first.
- **Resume:** chat events have their own ids. After a drop the phone reconnects, does a new handshake and
  says "I have up to event N". The Mac replays from a short buffer or sends a fresh snapshot. A deploy
  drops every socket; both sides reconnect at once with jitter, then back off, aiming for under 2 seconds.

## 6. What the phone can ask, and what the Mac decides

**The closed list** (strict schemas in `packages/contracts`, checked by the relay for shape and size, and by
the Mac after opening):

| Command | Limits on the Mac |
|---|---|
| `list-chats`, `read-chat` | Desktop chats only |
| `send` | Text (and later attachments) into a chat. New chats only in folders the desktop already uses; the phone can't name a folder |
| `stop` | The running reply |
| `set-mode` | Ask, Auto-accept edits, Plan, Bypass (section 8) |
| `set-model` | Only models the Mac lists |
| `answer-approval`, `answer-question` | Only the request id currently shown, once |
| today's `decide`, `run-agent`, `keep-awake` | Moved inside the sealed link (section 9) |

**Never from the phone:** a shell or terminal, files outside a chat, settings, adding folders, skills or
plugins, connectors, "Do it" computer use, Full access, port forwarding, billing. Unknown commands, extra
fields and oversized frames are dropped. The Mac keeps its own rate limits.

**The Mac stays the judge:**
- Off by default: "Let my phone use this Mac".
- While a phone is connected, top right: "David's iPhone is connected" with **Stop**.
- Settings → Phones lists each phone with **Remove**. axeai.com has Remove too.
- "What the phone did": every command, with time and chat, kept on the Mac.

## 7. Attackers, what stops them, and what they can still do

The first ten rows are the board's "How nobody can hijack it" artboard, in the same order.

| # | Attacker | What stops them | What they can still do |
|---|---|---|---|
| T1 | **Steals your Axe password** (or a web session cookie) | Driving the Mac needs a phone key in the Mac's signed list. A new phone needs a fresh QR from the Mac's screen and Allow at the Mac. The account alone opens a ticket but no sealed session. | See your device list and its metadata. Remove phones (annoying, not dangerous). Use your Axe credits on the website. |
| T2 | **Breaks into Axe's server** (relay, database, logs) | Frames are sealed between phone and Mac; the server has no keys. The allowed list lives on the Mac and is signed by it, so a phone id added to the database is ignored. A swapped key in the pairing fails the `s` MAC. Replays fail the sequence check. | See metadata: which Mac and phone, when, frame sizes and timing, chat ids (random). Drop or delay frames (the link closes; it never fails open). Serve bad web code: see T10. |
| T3 | **Photographs your QR** | `s` lives 2 minutes and works once. Even used in time, the Mac shows "Connect *their phone's name*?" and you press Not me. The QR is checked for your account, so they'd need your account signed in on their phone as well. | Make you see one unexpected Allow dialog. If you press Allow without reading it, they're in: the dialog is the gate, so it names the phone and says "until you remove it". |
| T4 | **Shows you a fake QR** (their Mac, a printout, a screenshot) | Your phone checks `accountTag` against your own account before sending anything, and the relay only routes pairing within one account. A stranger's Mac never appears. | Nothing on your account. A QR copied from your own Mac is T3. |
| T5 | **Listens on café Wi-Fi** | Two locks: TLS on each hop, and the sealed link inside it. | See that you use axeai.com. |
| T6 | **Copies the phone's login** (cookie, ticket) | Tokens only open a socket. The handshake needs the phone's private key, which is non-extractable, so a copy can't sign. Tickets work once in 30 seconds and never sit in a URL. | Open an empty socket that fails the handshake. |
| T7 | **Replays an old command** | Per-connection keys, numbered frames, strict next-number check, connection id in the authenticated data. A frame from an earlier connection or out of order fails. Approvals carry the request id and work once. | Nothing. |
| T8 | **Steals your unlocked phone** | Your phone's lock comes first. Then Remove on the Mac, or on axeai.com from any browser: the relay stops routing at once and the Mac drops the entry when it next connects. Stop on the Mac ends a session now. | Use your Mac's agents, in any mode, until you remove the phone. This is the price of no daily re-checks, accepted on 2026-10-26. |
| T9 | **Sends a command we never made** (hostile page, fuzzing, a hacked relay) | The closed list, strict schemas and size limits, checked again on the Mac after opening. No shell, files, settings or folders exist on the list. | Use the listed commands, and only through an allowed phone. |
| T10 | **Changes the website's code** (a hacked server or build serves hostile JavaScript; also any script injection on axeai.com) | The honest limit of every web app. Mitigations: strict CSP, no outside scripts on axeai.com (see 7a), Subresource Integrity on our own bundles, every command shown in "What the phone did", the connected banner, Stop always there. A native phone app later closes it. | While you have the page open, use the phone's keys from inside the page: the full list, Bypass included. It still can't read the keys out, so access ends when the tab closes or the phone is removed. |

Beyond the board:

| # | Attacker | What stops them | What they can still do |
|---|---|---|---|
| T11 | **Downgrade**: the relay says "this phone is old, use the plain path" | The Mac accepts chat commands only over the sealed link. Protocol version is in the authenticated data and pinned in the list entry. | Nothing. |
| T12 | **Floods** the relay or the Mac | Rate limits per account, per device and per IP. Frame size cap. The Mac drops bad frames without asking you anything. | Slow the link. Can't make the Mac show dialogs (pairing requests without a valid `s` never reach a dialog). |
| T13 | **Stolen or lost Mac** | macOS login, FileVault, and the Keychain sealing the device keys. Sign the Mac out on axeai.com: the relay stops routing to it. | Whatever a person signed in to your Mac can do anyway. |
| T14 | **Malware already on the Mac** | Out of scope: it can drive the agents without us. | Everything. |
| T15 | **Prompt injection** (a web page or file tells the agent to misbehave) | Same as at the desk. The phone changes nothing here: in Ask the approvals reach the phone; in Bypass they don't. | What it could do at the desk in the same mode. |
| T16 | **Push notifications** leak content | The server writes the push, so it carries only "Approval waiting in a chat" or "Reply finished", never chat text. | See that something happened. |
| T17 | **A phone removed on axeai.com while the Mac is off** | The relay stops routing at once. The Mac removes the entry on its next connect. Removing on axeai.com can only reduce access, so it's safe for the server to say it. | A hacked server can remove phones (T2), never add them. |

### 7a. Two things on axeai.com to fix before launch

Found while writing this. Both matter because the phone's keys are usable by any script running on
axeai.com.

1. **PostHog is allowed to load scripts** (`script-src ... https://us-assets.i.posthog.com` in
   `axe-web/infra/caddy/snippets.caddy`). That's an outside party who could run code next to the keys. Fix:
   bundle posthog-js ourselves, turn off its remote extension loading, and drop that host from `script-src`.
2. **`/preview-frame.html` runs scripts from CDNs on the axeai.com origin when opened directly.** In the
   chat it's in `sandbox="allow-scripts"` (an opaque origin), and it only takes messages from its parent, so
   it isn't exploitable today. But one change away it would be. Fix: send `Content-Security-Policy: sandbox
   allow-scripts` on that path so it's an opaque origin however it's opened.

## 8. Permission modes from the phone

**How Claude Code does it** (code.claude.com/docs/en/permission-modes and /remote-control, read
2026-10-26):
- From the phone or web you can pick Manual, Accept edits, Plan and Auto for a session on your machine.
  **Bypass can't be selected from the app.** You can only get Bypass if the session was started with it on
  the machine.
- Approvals and questions are forwarded to the phone and stay open until answered.
- Outbound HTTPS only, no open ports, several short single-purpose credentials.
- Not end to end encrypted: Anthropic stores the transcript to sync devices.
- Optional "Trusted Devices": an enrolled device per browser plus a sign-in under 18 hours, refreshed by
  Face ID or a passkey. Removing a device revokes it at once, and unused devices expire.

**What we copy:** outbound-only links, short single-purpose credentials, approvals and questions answered
from the phone, a list of devices with instant Remove, and the mode shown live on both sides.

**What we do better:** end to end sealing (the server can't read the transcript), a device key that a
copied login can't use, and approval at the Mac instead of approval by account.

**Where we differ, by the maintainer's call:** no Face ID step-up, and **Bypass can be chosen from the phone**. Claude
Code doesn't allow that, so it needs a decision (section 11, question 1).

How the modes work underneath: for CLI agents the agent always stays in its own asking mode and Axe's
engine answers for you (`agents/modes.ts`). So even in Bypass every action passes through the Mac, is
saved first (Undo, Rewind) and lands in "What the phone did".

## 9. Today's link

Today a browser is "paired" by a flag on its web sign-in (`remotePairedUntil`, 7 days, or 24 hours with the
Mac's 8-character code). That's pairing by session, not by device, so a stolen cookie inherits it (T6). And
`decide` can approve an Inbox item. Plan: move `decide`, `run-agent` and `keep-awake` into the sealed link,
then retire the session flag and the 8-character code once the new pairing ships. Until then the old path
stays as it is and can't reach chat.

## 10. How we'll prove it

Automated tests (CI on both repos):
- A frame changed by the relay (one bit in the ciphertext, the authenticated data or the sequence number)
  is rejected, and the link closes after two.
- Replayed, reordered and cross-connection frames are rejected.
- A pairing request with a wrong or used `s`, a swapped phone key or a swapped Mac key never reaches a
  dialog.
- A phone id added on the server alone can't open a session.
- An expired, reused or URL-borne ticket is refused.
- Every command schema is fuzzed; unknown commands and extra fields are dropped.
- Reconnect during a deploy: kill the API process mid-stream; the phone is back within about 2 seconds and
  the reply carries on with no gap and no duplicate.

Before launch: a Strix pentest of the local stack, and a second read of the crypto by a fresh reviewer.

## 11. Decided by the maintainer, 2026-10-26

Signed off with these three calls:

1. **Bypass from the phone: yes**, with no extra tap. The Mac says so at once, in the banner and in "What
   the phone did" ("David's iPhone turned on Bypass in Fix the checkout test").
2. **Unused phones expire after 60 days** and drop off the list by themselves. No prompts while you use one.
3. **Add to Home Screen** is suggested once on the phone after pairing, so iPhone Safari doesn't wipe the
   phone's key after 7 days without a visit.

## 12. Build notes (step 2, pairing)

- **Ids come from keys.** A Mac's id and a phone's id are the first 16 bytes of the SHA-256 of their Ed25519
  public key. The server can't give a new key an old id. The server's own device row (tied to a sign-in) is
  not used for pairing.
- **The QR is a link**, `https://axeai.com/connect#<payload>`. The phone's own Camera app opens it too. The
  part after `#` never reaches the server; the page wipes it from the address bar as soon as it reads it.
- **Two minutes, plus 20 seconds** for a scan already on its way when the code changes. Each code still
  works once.
- **The Mac names the phone from what the phone says** ("David's iPhone", "Safari on iPhone"). Only someone
  holding a live QR can send a name, so the dialog is still the gate.
- **WebCrypto Ed25519 and X25519 are required** on the phone (Safari 17, Chrome 133, Firefox 130 and later).
  Older browsers get "Update your browser to connect." P-256 fallback is not planned.
- **Until the sealed link (step 3)**, pairing travels over today's event stream and two HTTPS calls. The
  pairing messages are sealed already, so nothing changes in what the server can see.

Sources: Claude Code docs [Remote Control](https://code.claude.com/docs/en/remote-control) and
[Permission modes](https://code.claude.com/docs/en/permission-modes); Matrix MSC3903 (X25519 secure
channel with QR); RFC 5869 (HKDF); NIST SP 800-38D (GCM nonces); the SIGMA key exchange (Krawczyk, 2003).

## 13. Build notes (step 3, the link)

- **Code:** `remote-link.ts` (handshake, sealed numbered frames) and `remote-link-client.ts` (PhoneLink,
  MacLink: tickets, reconnect, resume), identical in axe-web `packages/contracts/src` and axe-mac
  `next/src/shared`. Relay: axe-web `apps/api/src/features/remote/relay.ts` at `/api/relay/{mac,phone}`.
  Mac wiring: `next/src/main/remote/link.ts`. Phone wiring: axe-web `apps/web/src/features/remote/mac-link.ts`.
- **Phone keys:** only the phone's Ed25519 key is kept. Its X25519 key is made fresh for each pairing and
  never stored: Safari (WebKit) can't keep an X25519 key in IndexedDB (it reads back as null). The link
  needs no static X25519 key; each connection makes its own.
- **Resume:** the Mac keeps its last 1,000 events. A phone that reconnects says the last one it has; the Mac
  replays the rest, or says "load afresh" if they're gone or the app restarted. Live events wait until the
  phone has said this, so a replay never lands after them.
- **Reconnect:** at once with jitter, then every second for about 30 seconds, then 2 to 15 seconds apart.
- **Deploys:** on SIGTERM the relay closes every socket with code 1012. Today's older event stream to the
  Mac keeps the old process up until Docker's stop timeout kills it; that doesn't delay the phone, which
  reconnects to the new process.
- **Proved locally, 2026-10-28:** a WebKit iPhone and the real app streamed events through a local API that
  was stopped and started again. The phone streamed again 667 ms after the new API was up, with every
  event once and in order across a five-second outage (`next/tests/e2e/link-run.mjs`). Unit and relay
  tests cover tampered, replayed, reordered and cross-connection frames, tickets, routing and Remove.

## 14. Build notes (step 4, chat from the phone)

- **The list:** `remote-commands.ts` (identical in both repos): chats, read, send, stop, mode. Picking a
  model or agent rides on send, as in the desktop window. Every command is checked against the schema
  after opening; extra fields, unknown commands and empty text are dropped. 40 commands per 10 seconds
  per phone.
- **Folders:** a new agent chat from the phone works in the folder of the newest agent chat on the Mac
  (that agent's first). With none, the phone is told to start one on the Mac first. The engine's own
  default is the home folder, which the phone never gets.
- **Mac side:** `next/src/main/remote/phone-chat.ts` runs commands through the chat engine the window uses
  and forwards chat events (replies at most every 120 ms per chat, always the last). "What the phone did"
  keeps the last 200 lines on the Mac. Turning on Bypass from the phone (new chat or switch) shows on the
  banner at once for 10 seconds and in the log.
- **Stop** on the banner ends every phone's session and turns "Let my phone use this Mac" off, so a phone
  can't come straight back; turning it on again in Settings brings paired phones back.
- **Phone side:** axeai.com/remote (board RCPhoneChat). The model and mode chips open the phone's own
  picker. The chats list and the pickers aren't drawn on the board; they follow the same look.
- **Not yet:** Codex and Gemini CLI work through the same path once ready on the Mac but weren't tested.
- **Proved locally, 2026-10-28:** `next/tests/e2e/chat-run.mjs` with the stand-in agent and a WebKit
  iPhone: a new chat in Bypass from the phone (banner says so, reply streams, file written, nothing asked),
  Ask mode waiting on the Mac, the log, and Stop cutting the phone off.

## 15. Build notes (step 5, answers and files)

- **Answers:** approvals, the agent's questions and plan Start/Change are all one kind of request with
  options. The phone answers with `answer {chat, request, option}`; the Mac accepts it only while that
  request waits in that chat and only with an option it offered, once. Answering on the Mac first removes
  it from the phone. Every answer goes into "What the phone did". "Always allow" is offered from the phone
  when the agent offers it, as on the Mac.
- **Files:** `upload` pieces of at most 96 KB, in order, up to 25 MB (the desktop's limit), three files at a
  time per phone, five minutes per file. The Mac strips folders from the name, picks the type from the
  extension, saves it in its own attachments store, and lets only that phone use it, once, in `send`.
  Pieces don't count against the command limit; their size does.
- **Proved locally, 2026-10-28:** `chat-run.mjs` answers Allow from the phone (the agent goes on and writes
  its file) and sends a 300 KB file in four sealed pieces (it arrives whole, in 0.6 s). Unit tests cover
  answers to other chats, made-up options, repeats, and uploads out of order, too big, or used by another
  phone.

## 16. Real CLIs from the phone (2026-10-28)

`chat-run.mjs <out> claude-acp` (or `codex-acp`) runs the same test with the real CLI. Both started from
the phone and their answers came back to it; neither could finish because of this Mac's own setup:
Claude Code was signed out (`claude auth status`: not logged in), and Codex's `~/.codex/config.toml` asks
for a model a ChatGPT account can't use (the same error from `codex exec` in a terminal). The phone now
shows a turn's error under the reply instead of an empty answer. Gemini CLI isn't installed here.

After the maintainer signed Claude Code back in, `chat-run.mjs <out> claude-acp` passed with real Claude Code: from the
phone it created a file in Bypass without asking, asked in Ask mode with its own options (Yes, Yes and
allow, No), went on after Yes from the phone, took a 300 KB file, and Stop cut the phone off. Codex is still
untested here (its configured model is refused for a ChatGPT account).
