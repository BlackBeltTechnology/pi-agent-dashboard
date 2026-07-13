# Signpost camera-scan as the primary cross-device pairing path

## Why

Cross-device pairing (dashboard on a laptop, PWA on a phone) already has a
**zero-typing path**: the pairing QR is a camera-actionable
`https://<tls-endpoint>/pair#<payload>` deep link. A phone's native camera opens
it, `PairLanding.tsx` reads the payload from `location.hash` and auto-runs the
handshake on mount — no typing, and the ~60s one-time-code TTL never bites.

But the operator UI (`GatewayPairQR.tsx`) never signposts that path. It renders a
small **132px** QR plus a prominent **copy-string box** with a copy button, and
no instruction to scan with a phone camera. A phone user reasonably reads the
`pi:pair:v1.…` string off the laptop and **thumb-types** it into the PWA paste
box — a 22-char, case-sensitive, `-_`-bearing base64url string that must be
entered (plus an identity-challenge round-trip and the redeem POST) within 60s of
mint. Only the first redeem restarts the TTL, so the manual path races the clock
and fails ~2 times in 3.

The flow is correct; the **presentation misroutes users onto the wrong path**.
The one path that makes the 60s window a non-issue (native camera scan) is the
only path that is never mentioned.

## What Changes

Operator-side UX only, in `GatewayPairQR.tsx`. No protocol, no TTL, no security
change:

- Add a clear primary instruction near the QR — **"Scan with your phone camera —
  no typing needed"** — presenting camera scan as THE cross-device path.
- Enlarge the pairing QR from 132px to ~180px so it locks reliably across a desk.
- Demote the copy-string to an explicitly labeled fallback (**"Or paste in the
  desktop app"**), so phone users are not lured into reading/typing it.

The `CODE_TTL_MS` (~60s) stays unchanged: with scanning signposted as primary,
the tight one-time-code window is correct.

## Discipline Skills

`accessibility-a11y` (the new instruction text + QR-size change must keep the
pairing view keyboard- and screen-reader-legible).

## Impact

- **Spec:** `qr-device-pairing` — MODIFY "Operator-side pairing view renders the
  payload" to require the view signpost native camera scan as the primary
  cross-device path and label the copy-string as a desktop/paste fallback.
- **Code:** `packages/client/src/components/Gateway/GatewayPairQR.tsx` (the only
  file touched — presentation strings + QR size + copy-string label).
- **Tests:** `GatewayPairQR` render tests assert the camera-scan instruction is
  present and the copy-string carries a fallback label.
- **Out of scope:** any `CODE_TTL_MS` change, a short human-typable code, or
  changes to `PairLanding.tsx` / `PairView.tsx` / the pairing protocol.
