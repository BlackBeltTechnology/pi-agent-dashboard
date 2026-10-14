## Why

Pairing a device with a dashboard is backwards for the LAN case. Today machine A's operator must open Gateway, mint a QR / deep link (`GET /api/pair/payload`), and carry it to machine B, which redeems it. And the payload admits only `https`/`wss` endpoints (`add-server-keypair-pairing` D4/D14), so a server discovered on the LAN at plain `http://192.168.x.y` yields "No reachable endpoint" — LAN pairing is impossible without a tunnel or a publicly-trusted certificate.

The user's mental model is the reverse: **B discovers A → clicks Connect → A shows an Allow dialog → B shows a PIN to type on A.** The approval half already exists (`add-pairing-approval-dialog`: app-wide dialog, typed 8-digit compare-code, deny, lockout, pending feed, `poll`). Only the device-initiated entry point and the LAN transport are missing.

```mermaid
sequenceDiagram
  participant B as Machine B
  participant A as Machine A
  B->>A: POST /api/pair/challenge (native client only: verify fp from mDNS)
  B->>A: POST /api/pair/request {name}
  A-->>B: {pendingId, confirmCode, expiresAt}
  B->>B: "Type 4821 7730 on home-imac"
  A->>A: approval dialog pops (existing)
  A->>A: operator types code → Approve
  B->>A: POST /api/pair/poll → bearer
```

## What Changes

- **Knock route `POST /api/pair/request`.** Unauthenticated, code-less. Creates a pending device directly (internally a single-use code bound to that pending entry), records redeemer metadata plus an untrusted requester `name`, and returns `{pendingId, confirmCode, expiresAt, fingerprint}`. From there the existing flow applies: app-wide dialog, typed compare-code, deny, the per-request lockout budget, pushed expiry, `poll` → bearer. The operator picks the device's tier in the knock dialog (default `operate`); `approve-pending` gains an optional `tier`.
- **Admission gates for knocks** (an unsolicited prompt is a nuisance/phishing vector):
  - setting `pairing.acceptLanRequests` (switch in Gateway ▸ Connect a device, written through the existing config route);
  - Host admission in enforce semantics (DNS rebinding), on top of the existing CSRF origin gate;
  - peer address private **and** on-link (same subnet as an interface the server serves on), not loopback, and no proxy-forwarding header at all (stricter than `isTrustedSource`, which only distrusts relayed loopback);
  - one live knock per source address; a new global cap of 3 live knocks and 10 admitted per 10 min (no pending cap exists today); per-address rate limit and a deny/lockout cooldown.
  Each refusal returns a distinct error code so B can explain it.
- **Plain-http LAN transport for this entry point only.** The QR/deep-link payload keeps D14 (TLS-only). The approval dialog and B's waiting screen label a knock over plain http as **unencrypted on this network**.
- **Dialog provenance.** The approval dialog distinguishes a knock ("A device on 192.168.16.31 asks to connect", the requester name only as "says it is …") from a QR redemption; requester name is display text only, never an authorization input.
- **Browser "Request access".** When a browser hits A without credentials and is network-denied, the Network-not-allowed banner offers **Request access** (always shown; the server decides admission): it runs the knock same-origin, shows the PIN, polls, then exchanges the bearer for the httpOnly `pi_dash_device` cookie (`POST /api/device-session`), whose `Secure` flag now follows the exchanging request's transport so a plain-http browser keeps it. Settings ▸ Network Discovery gains **Connect** on a discovered server, which opens that server's own origin on this landing.

- Mockup: mockups/knock-pairing.html (in this change) — as-built vs proposed for the approval dialog, `/pair?request` states, Gateway LAN switch + waiting provenance, Network Discovery Connect, network-denied banner; decisions, copy and scored checks in `mockups/ui-plan.md`.
- **Request access from an `operate_required` refusal — deferred.** `surface-operate-required-remedy` (not yet archived) owns the `remedies` list, so the `request-access` remedy ships in a follow-up once it archives. Presence rule decided here (design D10): offered iff the caller has no credential and its peer passes the knock's LAN gate; independent of `pairing.acceptLanRequests` and knock state, so it discloses only the caller's own network position.

## Capabilities

### New Capabilities
- `lan-knock-pairing`: device-initiated pairing request — route contract, admission gates, plain-http LAN labelling, "Request access" landing.

### Modified Capabilities
- `qr-device-pairing`: pending devices gain a provenance (`qr` | `knock`); the app-wide approval dialog and pending feed render knock provenance; the transport rule for the knock entry point is scoped separately from the payload's TLS-only rule.
- `known-servers`: Network Discovery rows gain a Connect action that opens the peer's pairing landing.
- `connection-status-banner`: the Network-not-allowed surface gains a Request access action (targeting the denying server) and moves to the warning severity tokens.
- `bearer-device-auth`: the device cookie drops `Secure` only for a direct plain-http LAN exchange; browsers keep their bearer until the cookie is proven.
- `spawn-correlation`: the client `requestId` stays UUIDv4 but no longer requires `crypto.randomUUID` (fallback via `crypto.getRandomValues` for non-secure contexts).

## Discipline Skills

- `security-hardening` — new unauthenticated endpoint that raises an operator prompt (flooding, social-engineering via requester name), bearer issued over cleartext LAN, admission by peer address (relayed-loopback/forwarded headers).
- `doubt-driven-review` — relaxes the TLS-only stance (D4/D14) for one entry point; review the threat model before it stands.
- `observability-instrumentation` — log knock admitted/refused (reason) without codes; extend pairing health counters.
- `review-code` — before commit.

## Impact

- **Server:** `packages/server/src/pairing/pairing.ts` (knock entry, provenance, per-address slot), `packages/server/src/routes/pairing-routes.ts` (`/api/pair/request`, admission gates), `packages/server/src/auth/localhost-guard.ts` (private-range + relayed-loopback predicate reuse), config field `pairing.acceptLanRequests` in `packages/shared/src/config.ts`.
- **Client:** `components/pairing-approval/` (provenance + unencrypted label), `components/connectivity/PairLanding.tsx` (Request access mode), network-denied surface, `NetworkDiscoverySection.tsx` (Connect).
- **Protocol:** additive route + additive `provenance` field on pending views; existing QR flow and its clients unchanged.
- **Rollback:** disable `pairing.acceptLanRequests` or revert the route; issued bearers stay valid and revocable from Paired devices.
- **Sequence:** 2 of 4 — depends on `stabilize-mdns-server-identity` (fingerprint in TXT for B's identity check); consumed by `add-electron-server-windows`; prerequisite for `retire-trusted-networks-bypass`.
