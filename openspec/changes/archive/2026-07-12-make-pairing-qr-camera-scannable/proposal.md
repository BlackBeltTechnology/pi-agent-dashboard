# Make the pairing QR scannable by a phone camera

## Why

The device-pairing QR (`GatewayPairQR.tsx` → `encodePayloadString`) encodes an
opaque `pi:pair:v1.<base64url>` string. A phone's native camera only offers to
ACT on a QR whose content is a recognized actionable scheme (`https`, `tel`,
`mailto`, `wifi`, `geo`, or a registered custom-scheme app). `pi:pair:v1.…` is
none of these — no app on the phone claims the `pi:` scheme — so scanning it does
nothing (or shows raw text at best).

Today the pairing QR is only consumable by the Electron shell
(`packages/shell/.../PairView.tsx`), which pastes or in-app-scans the string and
runs the challenge → redeem → confirm → poll handshake. A remote phone has no way
in. The user's goal: **scan the pairing QR with a phone camera and land in a
browser that pairs the phone as a trusted, revocable dashboard client.**

## What Changes

Wrap the SAME opaque payload in a scannable `https://` deep link and serve a
browser port of the pairing client at `/pair`:

- **QR content** becomes `https://<tls-endpoint>/pair#pi:pair:v1.<base64url>`.
  The payload rides in the URL **fragment** (`#…`), which is never sent in the
  HTTP request → the one-time code stays out of server access logs and the
  `Referer` header, matching today's "code only travels in the POST body" posture.
- **New `/pair` route** serves a browser `PairView` (a port of the Electron one)
  that reads `location.hash`, decodes the payload, and runs the IDENTICAL
  handshake: `/api/pair/challenge` (verify pinned fingerprint) → `/api/pair/redeem`
  → show confirm code ON THE PHONE → poll `/api/pair/poll` → store the minted
  bearer in the browser. The phone becomes a paired, revocable dashboard client.
- **Desktop approval unchanged (D12):** the operator at the authenticated
  dashboard TYPES the confirm code shown on the phone into `/api/pair/approve`.
  No security relaxation — the compare-code trust decision stays exactly as-is.
- **Copy-string unchanged:** the copyable text stays `pi:pair:v1.<base64url>` for
  Electron paste. Electron's scan/decode gains a one-line tolerance to strip a
  `https://…/pair#` wrapper, so ONE QR serves both the phone camera and Electron.

Non-goals: no native app / universal-link scheme, no change to the redeem/approve
protocol, no change to `urls[]` transport gating (D14 — only TLS endpoints ride
the pairing QR, which the https landing URL inherently satisfies).

## Impact

- **Spec:** `qr-device-pairing` — MODIFY "Pairing payload rendered as QR and
  copy-string" so the QR encodes a scannable `https` deep link with the payload
  in the fragment; the copy-string stays the raw `pi:pair:v1.…` string.
- **Code:**
  - `packages/client/src/components/Gateway/GatewayPairQR.tsx` — QR encodes the
    https-wrapped form (new helper); copy-string unchanged.
  - New `/pair` route + browser `PairView` (port of `packages/shell/.../PairView.tsx`;
    keyring → browser token store). Reuses `/api/pair/*` unchanged.
  - `packages/shell/.../PairView.tsx` (or its `decodePayloadString`) — tolerate a
    `https://…/pair#<payload>` wrapper so the same QR still pastes/scans in Electron.
- **Tests:** QR encodes an https URL whose fragment decodes to the original
  payload; browser `/pair` runs redeem→confirm→poll; Electron decode tolerates the
  wrapper; fragment (not query) carries the code.
- **Coherence with `add-gateway-qr-network-selector`** (in progress, presentation-
  only, one-QR-at-a-time): COMPLEMENTARY, same file. That change makes the tunnel
  pairing QR the default single code; this change makes that code actually
  camera-scannable. Land ordering: rebase whichever merges second onto the other's
  `encodePayloadString` / QR-content edit. No protocol conflict.

## Discipline Skills

- `security-hardening` — the QR now yields a phone-openable URL that redeems a
  one-time pairing code; verify fragment-not-query keeps the code out of logs,
  the challenge/fingerprint-pin step is preserved in the browser client, and the
  D12 desktop approval is not weakened.
