# Design — Make the pairing QR camera-scannable

## Problem shape

```
 QR/copy-string  pi:pair:v1.<b64>   ── consumed ONLY by Electron shell today
        │
        ▼
  challenge → redeem → confirm(operator types) → poll → keyring bearer

 Phone camera: sees "pi:pair:v1.…" → not an actionable scheme → dead end.
```

Goal: a phone camera scan opens a browser that runs the exact same handshake and
pairs the phone as a revocable dashboard client — without weakening D12.

## Chosen approach: https deep link, payload in the fragment

```
 QR encodes:  https://<tls-endpoint>/pair#pi:pair:v1.<base64url>
              └────────┬───────────┘└──┬─┘└──────────┬────────┘
               phone opens in browser  landing     same opaque payload
                                        route      (JSON {v,id,code,urls[]})
```

Browser `PairView` served at `/pair`:

```
 hash → decode pi:pair:v1.<b64> → {v,id,code,urls[]}
   1. CHALLENGE  POST /api/pair/challenge → verify fingerprint == payload.id
   2. REDEEM     POST /api/pair/redeem {code} → {pendingId, confirmCode}
   3. show confirmCode ON THE PHONE
   4. POLL       POST /api/pair/poll {pendingId} until approved → bearer
   5. store bearer in browser (localStorage/cookie) → open dashboard
```

Desktop operator (authenticated) types confirmCode → `POST /api/pair/approve`.
Identical to the Electron flow; only the keyring sink changes to a browser store.

## Decision 1 — Fragment vs query for the payload

Chosen: **fragment (`#…`)**.

| | Fragment `#payload` | Query `?p=payload` |
|---|---|---|
| Sent to server in request | No | Yes |
| Lands in access logs | No | Yes |
| Leaks via `Referer` | No | Yes |
| Readable by page JS | Yes (`location.hash`) | Yes |

The one-time `code` is a short-TTL secret. Keeping it in the fragment preserves
today's invariant that the code only travels in the `/api/pair/redeem` POST body.
The static `/pair` document is identical regardless of payload, so the server
never needs the fragment.

## Decision 2 — Which endpoint hosts `/pair`

The QR URL commits to ONE origin, but `payload.urls[]` may list several TLS
endpoints. Choose the **primary TLS endpoint** (first of `pairingEps`) as the
landing origin. The full `urls[]` still rides in the fragment, so the browser
`PairView` keeps the Electron behaviour of iterating `urls[]` in the CHALLENGE
step and pinning the first that verifies. Landing same-origin means the
`/api/pair/*` POSTs are same-origin (no CORS). D14 guarantees the landing origin
is TLS.

## Decision 3 — "Paired" for a browser (no keyring)

Electron persists into an OS keyring; a browser has none. The browser `PairView`
stores the minted bearer in the browser (localStorage or an httpOnly-equivalent
cookie set by the client) so subsequent dashboard loads are authenticated as this
paired device. Revocation still works server-side via `/api/paired-devices/:id`.
Optional (follow-up, not this change): offer PWA-install to make the paired
client durable/home-screenable.

## Decision 4 — One QR for both consumers

- QR = `https://<ep>/pair#pi:pair:v1.<b64>`.
- Copy-string = `pi:pair:v1.<b64>` (unchanged; Electron paste unaffected).
- Electron `decodePayloadString` (or `scanQr`) gains: if the scanned value is an
  `https` URL, take `url.hash` (strip leading `#`) as the payload before decoding.
  So Electron "Scan QR" of the new QR still works.

## Decision 5 — Interaction with `add-gateway-qr-network-selector`

That in-progress change is presentation-only: one selectable QR at a time,
default = the TLS pairing endpoint. It explicitly leaves `encodePayloadString`
semantics alone. This change rewrites what the pairing QR *encodes*. They meet at
`GatewayPairQR.tsx`. Resolution: both edit the pairing-QR content path; whichever
lands second rebases its one-line QR-content change. No protocol or spec conflict
(that change targets `tunnel-provider`; this targets `qr-device-pairing`).

## Security review (security-hardening)

- **Code confidentiality:** fragment keeps the one-time code out of logs/Referer
  (Decision 1). No regression vs today.
- **Server-identity pinning preserved:** browser `PairView` runs the CHALLENGE
  step and refuses on fingerprint mismatch, exactly like Electron.
- **Approval unchanged:** D12 typed compare-code on the authenticated desktop is
  untouched; a scanned QR alone cannot self-approve.
- **No new public surface:** `/pair` is a static document; all trust operations go
  through the existing `/api/pair/*` routes with their existing rate-limits.
- **Replay:** one-time code + single pending slot + TTL are unchanged; a
  re-scanned/replayed URL redeems at most one pending device, rate-limited.

## Open follow-ups (out of scope)

- PWA-install prompt on successful browser pairing (durability).
- Native universal-link / `pi://` app handoff (would need domain-association
  files + app install).
