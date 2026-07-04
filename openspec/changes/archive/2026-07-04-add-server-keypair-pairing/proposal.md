## Why

Today the only remote-auth method is OAuth (GitHub/Google/OIDC), which needs a
registered OAuth app and a public provider — heavy for a self-hosted personal
tool. There is no "just let *my* phone in" path. Worse, the PWA is served **by**
the server, so an installed app is bound to one server's origin, and JWT auth is
a cookie (origin-bound) — which does not survive the cross-origin hops a
multi-server client needs. And a zrok tunnel currently arrives as `127.0.0.1`,
so remote tunnel access bypasses the app-layer auth entirely.

This change adds an **optional** public-key device-pairing method: each server
generates a persistent Ed25519 identity, a phone pairs by scanning a QR (or
pasting a copy-string), and a neutral static PWA shell holds a keyring of paired
servers. It sits **alongside** OAuth — nothing existing is removed.

## What Changes

- **Server identity keypair.** On startup each server ensures a persistent
  Ed25519 keypair (`~/.pi/dashboard/identity.key`, 0600). Its public-key
  fingerprint is the server's stable identity across URL changes.
- **QR / copy-string pairing.** Server produces a pairing payload
  `{ v, id, code, urls[] }` — protocol version, pubkey fingerprint, a
  **short-lived one-time** pairing code (~60 s TTL), and **all** currently
  wss-reachable endpoints (active tunnel, TLS LAN URL). Rendered as a QR **and**
  a copyable string (camera-less fallback).
- **Multi-URL, one identity.** The QR carries several URLs under one pinned
  identity; the client races them per network and keeps whichever proves the
  pinned key. Switching networks (cellular ↔ Wi-Fi ↔ VPN) needs no re-pairing.
- **Bearer device auth (alongside OAuth).** Redeeming a pairing code issues a
  **long-lived opaque bearer token** recorded in a server-side **paired-devices
  registry** (revocable per device from Settings). A new auth branch validates
  `Authorization: Bearer` (REST) and a token-bearing WS subprotocol, feeding the
  same `request.isAuthenticated` flag — one added `OR` branch, no regression.
- **Server-identity challenge.** On connect the client sends a nonce; the server
  signs it with its private key; the client verifies against the pinned pubkey —
  detects an impostor even when a URL is reused.
- **Neutral PWA shell (Topology 3).** A stateless static client published to
  `https://pi-dashboard.dev` (GitHub Pages). It holds the keyring in IndexedDB,
  is not bound to any server origin, and is no server's single point of failure.
  The existing server-served PWA (localhost + tunnel) keeps working unchanged.
- **CORS default.** Add `https://pi-dashboard.dev` as a built-in CORS default
  (next to the existing `*.share.zrok.io` rule) so every server trusts the
  neutral shell out of the box; users still extend via `cors.allowedOrigins`.
- **Versioned pairing protocol.** Because the shell (GitHub Pages) and servers
  release on independent cadences, the pairing payload + handshake carry a
  protocol version and servers keep backward-compatible pairing routes.

## Capabilities

### New Capabilities
- `server-identity-keypair`: persistent Ed25519 server identity; fingerprint;
  nonce challenge-response proving key possession.
- `qr-device-pairing`: short-lived one-time pairing codes; QR + copy-string
  payload `{ v, id, code, urls[] }`; versioned pairing handshake + redemption.
- `bearer-device-auth`: opaque long-lived bearer tokens; server-side revocable
  paired-devices registry; bearer branch in the auth/network guard for REST + WS.
- `device-keyring-client`: neutral static PWA shell holding a per-device keyring
  of `{ url(s), pinnedPubkey, bearerToken }`; multi-URL racing; identity pinning.

### Modified Capabilities
- `server-cors`: add `https://pi-dashboard.dev` as a built-in allowed origin.
- `cross-origin-client`: bearer-over-WS (subprotocol) + cross-origin bearer REST
  as an auth mode independent of the origin-bound cookie.

## Impact

- **Server**: `auth-plugin.ts` / network guard (new bearer branch), new
  `identity`/`pairing`/`paired-devices` modules + `/pair/*` + challenge routes,
  `server.ts` CORS default, Settings API for device revocation. Additive only.
- **Client**: new neutral-shell build target + keyring store (IndexedDB), pairing
  UI, server-identity verification on connect. Existing `ServerSelector` /
  `server-switch` reused.
- **Config**: `cors.allowedOrigins` default; new `pairedDevices` persistence.
- **Constraint**: neutral HTTPS shell reaches only `wss://` servers (tunnel free,
  TLS per-box, plain-http LAN excluded); localhost keeps a self-served-shell
  escape hatch.
- **Deploy**: new GitHub Pages publish pipeline for `pi-dashboard.dev`.
- **Dependencies**: a QR-encoding lib (client); Node `crypto` Ed25519 (no new
  server dep).

## Mockups

Static UI prototypes (dark theme, not wired) live in [`mockups/`](mockups/) —
open [`mockups/index.html`](mockups/index.html) as the gallery. Screens:

- [`1-dashboard-pairing.html`](mockups/1-dashboard-pairing.html) — server-side pair view: QR + copy-string, fingerprint, one-time-code TTL, wss endpoints, paired list.
- [`2-pairing-empty.html`](mockups/2-pairing-empty.html) — "no secure road" empty state (secure-context constraint): start tunnel / enable TLS / localhost escape hatch.
- [`3-shell-pair.html`](mockups/3-shell-pair.html) — neutral shell: scan QR / paste copy-string / pinned-identity success confirm.
- [`4-shell-keyring.html`](mockups/4-shell-keyring.html) — neutral shell: multi-server keyring + per-server "roads raced per network" detail.
- [`5-identity-warning.html`](mockups/5-identity-warning.html) — pin-mismatch refusal (Model 1 payoff: impostor caught on a reused URL).
- [`6-settings-devices.html`](mockups/6-settings-devices.html) — Settings → Security → Paired Devices: revocable registry + per-device revoke confirm.

Review locally: `serve` the `mockups/` dir (any static server) and open `index.html`.

## Discipline Skills

- `security-hardening` — pairing secrets, bearer tokens at rest, key storage,
  challenge-response, CORS surface, device revocation.
- `doubt-driven-review` — versioned pairing protocol + cross-origin auth are
  hard-to-reverse public contracts; stress-test before they stand.
