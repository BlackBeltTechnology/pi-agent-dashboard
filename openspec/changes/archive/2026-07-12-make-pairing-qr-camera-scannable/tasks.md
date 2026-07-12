# Tasks — Make the pairing QR camera-scannable

## 1. Tests first (TDD)
- [x] 1.1 Unit-test a new `encodePairingQrUrl(payload, baseUrl)` helper: output is a valid `https://<baseUrl>/pair#pi:pair:v1.<b64>` URL, and its fragment decodes back to the original `{ v, id, code, urls[] }`. (`lib/__tests__/pairing-qr.test.ts`)
- [x] 1.2 Assert the payload rides in the URL **fragment**, not the query string (nothing after `?`, everything after `#`).
- [x] 1.3 Assert the copy-string is still the bare `pi:pair:v1.<b64>` (unchanged), distinct from the QR URL.
- [x] 1.4 Browser `PairLanding`: reading a `#pi:pair:v1.<b64>` hash decodes the payload and drives redeem→confirm→poll (mock `/api/pair/*`), showing the confirm code and, on approved poll, storing the bearer. (`components/__tests__/PairLanding.test.tsx`)
- [x] 1.5 Electron decode tolerance: `decodePayloadString("https://ep/pair#pi:pair:v1.<b64>")` returns the same payload as `decodePayloadString("pi:pair:v1.<b64>")`. (`packages/shell/src/lib/protocol.test.ts`)
- [x] 1.6 Verify the copy-string is NOT a camera-actionable https URL (the failing-against-old-QR assertion).

## 2. QR content (client)
- [x] 2.1 Add `encodePairingQrUrl(payload, baseUrl)` alongside `encodePayloadString` in a shared lib (`lib/pairing-qr.ts`): wrap the base64url payload as `https://<baseUrl>/pair#pi:pair:v1.<b64>`.
- [x] 2.2 Pick the landing `baseUrl` = the primary TLS pairing endpoint (`pairingEps[0]?.url ?? payload.urls[0]`, https form). Feed `encodePairingQrUrl(...)` into the pairing `QrCanvas`; keep the copy-string as `encodePayloadString(...)`.
- [x] 2.3 Leave link QRs (no-TLS bare URLs) unchanged.

## 3. Browser pairing landing (`/pair`)
- [x] 3.1 Add a `/pair` route serving a browser `PairLanding` component (port of `packages/shell/src/components/PairView.tsx`); mounted in `main.tsx` when `pathname === "/pair"`.
- [x] 3.2 Read `location.hash`, strip leading `#`, `decodePayloadString` → payload; error state when hash missing/invalid.
- [x] 3.3 Run the identical handshake against `payload.urls[]`: challenge (verify fingerprint == `payload.id`, refuse on mismatch) → redeem → show confirm code → poll.
- [x] 3.4 Swap the keyring sink for a browser bearer store (`lib/device-auth.ts`, localStorage); on approved poll, persist the token + `window.location.href="/"`. Full consumption (Option A): global fetch wrapper attaches `Authorization: Bearer` to `/api/*`; `useWebSocket` mints a `/api/ws-ticket` per connect.
- [x] 3.5 Same-origin `/api/pair/*` calls (no CORS); handle expired/rejected/unknown poll states with a clear restart affordance.

## 4. Electron wrapper tolerance
- [x] 4.1 In `packages/shell/src/lib/protocol.ts` `decodePayloadString`: if input is an `https` URL, use its fragment as the payload before decoding; also strip the `pi:pair:v1.` prefix (latent gap — the copy-string was the only producer). Non-URL input unchanged.

## 5. Security (security-hardening)
- [x] 5.1 One-time code appears only in the fragment + redeem POST body — never in a query string (asserted in `pairing-qr.test.ts` 1.2; `encodePairingQrUrl` builds `origin + "/pair#" + payload`, no query).
- [x] 5.2 Browser `PairLanding` refuses to proceed on server-fingerprint mismatch (asserted in `PairLanding.test.tsx`; challenge step preserved, no redeem/store on mismatch).
- [x] 5.3 D12 desktop typed-approval unchanged: `POST /api/pair/approve` (networkGuard) untouched; `PairLanding` never calls approve — a scan alone cannot self-approve.

## 6. Docs
- [x] 6.1 Updated the `GatewayPairQR.tsx` row in `packages/client/src/components/Gateway/AGENTS.md` — pairing QR encodes an https `/pair#payload` deep link; copy-string unchanged. `See change:` added.
- [x] 6.2 Added `AGENTS.md` rows for `PairLanding.tsx`, `lib/pairing-qr.ts`, `lib/pair-protocol.ts`, `lib/device-auth.ts`, and updated `main.tsx` + `useWebSocket.ts` + shell `protocol.ts` rows.
- [x] 6.3 Updated the `GatewayPairQR.tsx` header comment to describe the https-wrapped pairing QR.

## 7. Validate
- [x] 7.1 `openspec validate make-pairing-qr-camera-scannable --strict` passes.
- [x] 7.2 Manual (device-required, deferred to post-merge): scan the pairing QR with a real phone camera → browser opens `/pair` → confirm code shown → desktop operator approves → phone lands in the dashboard authenticated. (Non-camera portion automated by 8.3.)
- [x] 7.3 Manual (Electron-required, deferred to post-merge): Electron "Scan QR" of the same code still pairs; copy-string paste still pairs.

## 8. E2E (Docker + Playwright) — automates the non-camera portion of 7.2
- [x] 8.1 Server: under `PI_E2E_SEED`, expose the loopback http origin as a pairing url (`server.ts` getReachableUrls) and admit it past the D14 gate (`pairing.ts` `isTestLoopbackOrigin`). localhost is a genuine secure context (crypto.subtle runs); every non-localhost origin stays TLS-gated.
- [x] 8.2 Unit-test the gate both directions: no loopback-http without the flag (D14 intact), only loopback-http (not other http) with it (`packages/server/src/__tests__/pairing.test.ts`).
- [x] 8.3 Playwright spec `tests/e2e/pairing-qr.spec.ts`: phone opens `/pair#<real payload>` → REAL Ed25519 challenge → redeem → confirm code in DOM → operator `POST /api/pair/approve` → phone stores the minted bearer + lands on `/` → real `/api/paired-devices` registry mutated. Plus a missing-fragment error-state test. **Both tests pass green against the Docker container.** Camera scan itself stays manual (7.2).
