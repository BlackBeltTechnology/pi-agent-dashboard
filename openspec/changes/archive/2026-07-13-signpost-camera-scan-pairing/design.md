# Design — signpost-camera-scan-pairing

## Context

Two pairing entry paths exist for a phone; only one races the 60s TTL.

```
INTENDED (zero typing)                    OBSERVED FAILURE (races 60s)
──────────────────────                    ───────────────────────────
phone NATIVE CAMERA → laptop QR           read pi:pair:v1.<22 chars> off laptop
  https://host/pair#payload               thumb-type into PWA paste box
  PairLanding reads location.hash         tap Pair
  auto-runs handshake on mount            verify round-trip + redeem POST
  TTL irrelevant                          ── all within 60s of mint → ~1/3 ──
```

`PairLanding.tsx` already auto-consumes the fragment (`useEffect(() => start())`).
The zero-typing path works end-to-end; it is simply not signposted, and the
copy-string's prominence actively steers phone users into manual entry.

## Goals / Non-goals

- **Goal:** make native camera scan the obvious primary cross-device path in the
  operator UI, so users stop thumb-typing the copy-string.
- **Non-goal:** change `CODE_TTL_MS`, add a short human-typable code, or alter the
  pairing protocol / `PairLanding` / `PairView`. Direction B (make manual entry
  viable) was explicitly deferred: with scanning signposted, manual entry stops
  being the default and the tight security window stays correct.

## Decisions

- **D1 — Signpost, don't re-engineer.** Root cause is discoverability, not a code
  defect. Fix = presentation strings + QR size in one component. Keeps the
  128-bit one-time code's ~60s window intact (the security posture stays as
  shipped by `add-server-keypair-pairing`).
- **D2 — QR size 132px → ~180px.** 132px is hard for a phone camera to lock onto
  across a desk. ~180px improves scan reliability without dominating the panel.
  Exact value tuned during implementation; keep it responsive-safe.
- **D3 — Copy-string demoted, not removed.** It remains the Electron/native paste
  fallback (spec: "copy-string stays a bare payload for paste"). It gets an
  explicit "Or paste in the desktop app" label so phone users read it as a
  fallback, not the primary action.
- **D4 — No behavioural gate change.** The advisory countdown, the approval flow,
  the transport gate, and `/api/pair/payload` are untouched.

## Risks

- **Over-demoting the copy-string** could hurt the Electron paste path. Mitigation:
  keep it visible with its copy button; only add a fallback label and let the
  camera instruction take visual primacy.
- **A11y regression** from new text / larger QR. Mitigation: `accessibility-a11y`
  checkpoint — instruction is real text (not icon-only), QR keeps its role/label,
  keyboard order unchanged.
