## Context

Current auth (see `docs/architecture.md` §Network Access Control, §OAuth): a
two-layer model — network guard (loopback / trusted-network IP / `isAuthenticated`)
+ an optional OAuth plugin issuing an origin-bound **JWT cookie** signed with a
**symmetric** secret. Multi-server switching already exists (`ServerSelector`,
`server-switch.ts`, server-side `known-servers`, mDNS discovery), and CORS is
already implemented (`@fastify/cors`, `server.ts:850`, allows loopback / active
tunnel / `*.share.zrok.io` / `cors.allowedOrigins`). The PWA registers a service
worker (`main.tsx` → `/sw.js`) and is served **by** the server.

Gaps this design fills: no phone-first auth; cookie auth dies cross-origin; the
installed PWA is bound to one server origin; zrok tunnels bypass app auth.

## Goals / Non-Goals

**Goals:**
- Optional public-key device pairing that needs no OAuth provider.
- One neutral client app usable against many servers (a keyring).
- Stable server identity that survives changing URLs (LAN/VPN/tunnel).
- Fully additive: OAuth-cookie path and server-served PWA unchanged.

**Non-Goals:**
- Replacing OAuth or the cookie path.
- Making plain-http LAN servers reachable from the HTTPS neutral shell
  (blocked by secure-context rules; use tunnel/TLS or the localhost shell).
- WebAuthn/passkeys (origin-bound; our URLs change).
- End-to-end encryption beyond TLS + identity pinning.

## Decisions

### D1 — Topology 3: neutral static shell on GitHub Pages
A stateless PWA at `https://pi-dashboard.dev` (GitHub Pages). Holds the keyring
in IndexedDB; not bound to any server origin; no server is a SPOF for booting the
shell. Servers become CORS + bearer APIs. The server-served PWA (localhost +
tunnel) remains a valid, unchanged front door. Rationale: only a stable neutral
origin delivers "one app, many servers" without a home-server dependency.

### D2 — Model 1: server-identity pinning (TOFU, SSH-style)
Server holds a persistent **Ed25519** keypair; pubkey fingerprint = identity.
First pairing pins it on the device. On each connect the client sends a nonce,
the server signs it, the client verifies vs. the pinned key — detects an impostor
even when a URL is reused. Chosen over client-keypair (D2-alt: home-rolled
passkey — more moving parts) and over JWT-only asym signing (no real gain over
today's symmetric secret).

### D3 — Multi-URL under one identity
QR payload `{ v, id, code, urls[] }`. `urls[]` lists every currently
wss-reachable endpoint (active tunnel, configured TLS LAN URL). The client stores
all under the one pinned identity and **races** them per network, keeping any that
respond AND prove the key. No re-pair when networks change.

### D4 — Secure-context constraint (explicit, not a surprise)
A neutral HTTPS shell + service worker require a secure context, and a secure
page cannot open `ws://` (mixed content). Therefore only `wss://`/`https://`
servers are reachable: tunnel (free wss), TLS LAN (cert per box); plain-http LAN
is **out**. Escape hatch: `http://localhost` stays a secure context, so the
server keeps serving its own shell for the same-desktop case.

### D5 — Bearer tokens, opaque + revocable registry (not JWT, not cookie)
Redeeming a one-time pairing code issues a **long-lived opaque** bearer token,
stored in a server-side **paired-devices registry** (`~/.pi/dashboard/paired-devices.json`,
0600) with device label, created-at, last-seen. Revoke = delete the row (per
device, from Settings). Bearer beats cookie because it survives cross-origin
(no SameSite death on iOS PWA). Opaque beats self-contained JWT because
revocation is a row delete, no denylist. Token sent as `Authorization: Bearer`
(REST) and via `Sec-WebSocket-Protocol` (WS can't set headers in-browser).

### D6 — Pairing code: short-lived, one-time
Pairing code ~60 s TTL, single redemption, rate-limited. It is NOT the
credential — it is exchanged for the bearer token over the proven-identity
channel. Limits shoulder-surf / screenshot exposure of the QR.

### D7 — Auth integration = one OR branch
The bearer check is an added branch feeding the existing `request.isAuthenticated`
flag (guard order `onRequest` → `preHandler` unchanged). Cookie path, static
serving, `ServerSelector` untouched. A user who never pairs sees no difference.

### D8 — CORS default for the neutral shell
Add `https://pi-dashboard.dev` as a built-in default beside the `*.share.zrok.io`
rule. CORS (origin-keyed: which page may READ responses) stays distinct from
trusted-networks (IP-keyed: which source IP bypasses auth). Bearer — not ambient
cookies — remains the auth, so opening CORS to the shell weakens nothing.

### D9 — Versioned pairing protocol
Shell (GitHub Pages, always-latest) and servers (long-lived, varied versions)
release independently. Payload + handshake carry `v`; the client negotiates the
highest mutually supported version; servers keep backward-compatible pairing
routes. Prevents lockstep releases.

### D10 — Genuine-local trust via allowlist, NOT a network-loopback check (fixes zrok hole)
**Critical, from doubt F1; revised after cycle-2.** `isLoopback(request.ip)`
short-circuits auth in the network guard, `onRequest`, AND independently in the WS
upgrade handler (`server.ts:1630`); zrok arrives as `127.0.0.1` so a tunnel URL
bypasses everything. Cycle-2 killed the naive fix: detecting the proxy hop by a
marker is a **blocklist** — `ssh -R`/ngrok/SSRF inject no marker and still look
local. Correct fix is an **allowlist of genuine local IPC**, not a network address
check: local CLI tools authenticate over a **dedicated Unix domain socket** (which
no reverse proxy can target) or with an **explicit local token**; the TCP
loopback address is NO LONGER auth-exempt for anything a listener/proxy can reach.
Apply at ALL three call sites (guard, `onRequest`, WS upgrade).
**Cycle-3 (Critical):** removing TCP-loopback trust BREAKS the existing same-host
callers that rely on it — the pi bridge connects to `ws://localhost:${piPort}`
(`bridge.ts:662`) with no cookie/bearer, plus terminal/editor/model-proxy. This
is NOT purely additive without a migration: the bridge (and other local callers)
MUST move to the Unix socket or carry a persistent local token on the WS upgrade
before D10 lands. Socket path perms `0600` (explicit `chmod` after bind; default
umask yields world-accessible `0755`); local-token file in a `0700` dir.

### D11 — Authenticated WS ticket, no upgrade before auth (fixes CSWSH + TOCTOU)
**High, from doubt F4; revised after cycle-2.** `validateWsUpgrade` checks cookie +
IP but not `Origin` (CSWSH), and cycle-2 showed the first-frame-token idea creates
a **TOCTOU**: the socket is upgraded and may start receiving broadcasts before the
auth frame arrives, and CORS already **allows absent `Origin`** (`server.ts:853`)
so an Origin check alone is defeatable by non-browser clients. Correct fix: the
client first calls an **authenticated REST endpoint** to mint a **short-lived,
single-use WS ticket**, then opens the socket with that ticket; the server
**refuses the upgrade** unless the ticket validates — no authenticated socket ever
exists before auth. Origin-vs-CORS remains defense-in-depth only. A single-use
seconds-TTL ticket in the URL is acceptable (not the durable bearer), which also
resolves F6 (no durable token in headers/logs).
**Cycle-3:** the ticket MUST be a high-entropy random value held in server memory
and deleted synchronously on the FIRST upgrade attempt (stateless JWT cannot
enforce single-use); clients fetch a fresh ticket before every reconnect. The
minting endpoint MUST bind the ticket to a specific WS route/scope (`/ws`,
`/ws/terminal/*`, `/editor/*`) and the upgrade handler MUST reject a ticket used
against a different route — else a low-privilege session mints a ticket and
escalates to a privileged socket.

### D12 — Compare-code approval; consume on approval, not redemption (closes race + spoof)
**High, from doubt F3; revised after cycle-2.** A one-time code that mints a durable
token lets a shoulder-surfer redeem first. Cycle-2 broke the naive approval fix
three ways: consuming the code **on redemption** lets the attacker DoS/lock-out
the victim's scan; an **attacker-controlled label** ("My iPhone") spoofs the
approval; and the approval endpoint is auto-satisfiable via the D10 bypass.
Correct fix: (1) consume the code only on **approval**, never on redemption; (2)
display a **server-generated numeric confirmation code on BOTH the dashboard and
the pairing device** (compare-and-match, like Bluetooth/Signal) — never trust a
client-supplied label for the trust decision; (3) the approval endpoint requires a
genuine authenticated **browser session** and MUST NOT honor the loopback/tunnel
bypass (depends on D10). Rate-limit + lockout on repeated bad codes.
**Cycle-3 (Critical + High):** "consume on approval" allows UNLIMITED redemptions
of one QR payload → unbounded in-memory pending devices (OOM DoS), a flood of
approval prompts, and 4-digit code collisions (birthday) that trick approval. Fix:
a payload allows at most ONE active pending device (subsequent redemptions
overwrite the slot or are hard rate-limited per pairing session); the confirmation
code has enough entropy to resist brute-force within its short window. And the
approval UX MUST be ACTIVE not passive: the user TYPES the code shown on the
physical device into the dashboard (no one-click "Approve" of a pushed prompt),
defeating habituated blind-approval of an attacker-triggered request.

### D13 — Reconsider Model 2 (non-extractable client key) to bound shell-compromise blast radius
**High trade-off, from doubt review F2.** A public shell holding long-lived bearer
tokens in IndexedDB means a GitHub-Pages/account compromise exfiltrates every
paired server's token globally. Strong mitigation: pair a WebCrypto
**non-extractable** client keypair (private key never leaves the device); the
bearer becomes a short-lived token minted per-session by signing the server nonce
with that key. A malicious shell build then cannot steal a reusable credential.
Open decision for specs: adopt Model 2 client-key hardening now vs. ship opaque
bearer + document the risk + subresource-integrity/pinned-deploy controls.

### D14 — Only publicly-trusted TLS works from the neutral shell
**Med, from doubt review F5.** A neutral HTTPS shell cannot connect to a
self-signed LAN `wss://` (browser blocks with no prompt in fetch/WS context). So
"TLS LAN" (D4) means a **publicly-trusted** cert (e.g. via a real hostname), not a
self-signed one. QR endpoint emission must not advertise self-signed URLs as
reachable; honest UX = tunnel or a properly-CA'd hostname, else localhost hatch.

## Risks / Trade-offs

- **Secure-context wall (D4).** Plain-http LAN unreachable from the shell. Mitigate:
  QR emits only wss-capable endpoints; honest "start the tunnel to pair" UX;
  localhost escape hatch.
- **GitHub Pages limits.** No custom response headers (CSP via `<meta>`; no
  COOP/COEP — not needed), no SPA rewrites (use hash routing / 404 fallback).
- **Public shell bundle / supply chain (F2, D13).** The shell holds long-lived
  tokens at rest; a compromised GH Pages deploy could exfiltrate them for every
  paired server. Mitigate via D13 (non-extractable client key) and/or SRI +
  pinned/attested deploy + short token TTL. Do NOT dismiss as "holds no secrets."
- **Protocol versioning debt (D9).** Independent cadences require lasting
  backward-compat discipline on pairing routes.
- **Token at rest on device.** Long-lived bearer in IndexedDB. Mitigate: per-device
  revocation, last-seen visibility, optional token rotation later.
- **Impostor window.** TOFU trusts first contact. Mitigate: show fingerprint at
  pairing for out-of-band compare; pin thereafter.

## Doubt-Driven Review Outcome (3 cycles, cross-model gemini-3.1-pro)

Three adversarial cycles run. The DIRECTION (Topology 3 + Model 1) held, but each
cycle falsified the previous cycle's security fixes — and cycle 3 STILL surfaced
two Criticals (bridge-breakage under D10; unbounded-redemption DoS under D12).
Per the doubt-driven skill, three cycles with substantive findings is information:
this is a security-heavy change whose auth-boundary details are not "done" at
design level. Implications:
- Treat every D10–D14 spec requirement as a HARD gate in implementation, verified
  by `security-hardening` with explicit tests (bypass, replay, DoS, perms).
- D10 has a PREREQUISITE migration (same-host callers off TCP-loopback) that must
  land first or the bridge/terminal/editor/model-proxy break.
- Two PRE-EXISTING live vulns were uncovered (zrok→loopback bypass; WS Origin /
  CSWSH) — fix independently of this proposal.
- A 4th cycle was NOT run (skill bound); residual risk is implementation-detail,
  not architecture. Re-review the built code, not the design, next.

## Open Sub-Decisions (to resolve in specs)
- Exact bearer token length/format and rotation policy.
- Nonce-challenge wire format (piggyback on WS subscribe vs. dedicated `/identity/challenge`).
- Whether the Electron app doubles as a neutral **desktop** shell sharing the keyring format.
- QR library choice + copy-string encoding (base64url of JSON vs. a compact `pidp://` URI).
