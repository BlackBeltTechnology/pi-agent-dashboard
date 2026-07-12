# Design — Gateway QR network selector

## Context

`GatewayPairQR.tsx` today renders, in one screen:
1. the pairing QR (TLS tunnel) at top-left with the endpoint mini-list at right, then
2. a `linkEps.map(...)` row of one link QR **per** no-TLS endpoint.

`splitEndpoints(endpoints)` already partitions `{ pairing, link }` by transport
(scheme-authoritative `TLS_SCHEME`). The wall of QRs is purely a rendering choice
in the component — no server or contract change is needed to fix it.

## Decision: one QR, radio-row selector, tunnel default

Collapse the endpoint mini-list and the link-QR row into a single **selector →
one QR** layout. The selector is a radio group over the *union* of
`pairing ++ link` endpoints; the selected endpoint drives one `QrCanvas`.

```
CONNECT A DEVICE                         · code expires 47s
┌────────────┐   ┌───────────────────────────────────────┐
│            │   │ ●  PUBLIC  cwanni9…zrok.io    pairing  │ ◀ default
│  ONE QR    │   │ ○  LOCAL   localhost:8000    link      │
│ (selected) │   │ ○  LAN     192.168.16.220    link      │
│            │   │ ○  LAN     100.83.251.119    link      │
└────────────┘   │ ○  LAN     192.168.64.1      link      │
 one-time·47s    └───────────────────────────────────────┘
 fp sha256:hljQK

 ── context panel (swaps by selected kind) ──
 pairing → copy-string · "type confirmation code" · Approve
 link    → bare URL · "opens dashboard directly, no pairing"
```

### Selection model
- `selected: TunnelEndpoint` state, initialised to `pairingEps[0] ?? linkEps[0]`.
- Recompute the default whenever the endpoint set or pairing payload reloads
  (e.g. tunnel comes up → default jumps to the new TLS endpoint).
- `isPairingEligible(selected)` decides which context panel renders — reuse the
  existing helper, do not re-derive from `kind`.

### Why radio-rows (not a dropdown)
The list already exists and doubles as the "what networks are available" overview.
A dropdown would hide that. Rows keep the glanceable inventory AND collapse the
QR wall. Each row keeps its current `kind` pill; we add a `pairing`/`link` mode
tag so the two flows are legible before selecting.

## Decision: context panel swaps, controls are not duplicated

The pairing-only affordances — `pi:pair:v1.…` copy-string, expiry countdown,
fingerprint line, confirmation-code input + Approve — render **only** when a TLS
pairing endpoint is selected. For a `link` selection they are replaced by the
bare URL + the existing "opens the dashboard directly (no pairing, no secret)"
note. This prevents a meaningless "confirmation code" prompt against a LAN link.

## What does NOT change (invariants preserved)

- **D14 transport gate** — only TLS endpoints encode the pairing payload;
  `guardPairingUrls` still runs before encoding.
- **Link QR carries no secret** — bare URL string only.
- **Typed compare-code approval (D12)** — same flow, just gated to the pairing
  selection.
- **Contracts** — `/api/pair/payload`, `/api/tunnel/endpoints`,
  `splitEndpoints`, `guardPairingUrls` untouched.

## Accessibility

The selector is a real radio group: `role="radiogroup"`, each row
`role="radio"` + `aria-checked`, roving `tabIndex` (selected row `0`, others
`-1`), Up/Down/Left/Right moves selection, Space/Enter commits. This replaces the
current static QR tiles, which had no keyboard affordance.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Dropdown selector | Hides the available-networks inventory the list gives for free. |
| Tabs (Tunnel / LAN) | Two clicks to reach a specific LAN address; more chrome than rows. |
| Keep wall, shrink QRs | Smaller QRs scan *worse*; does not fix camera lock-on. |
| One "smart" QR of all URLs | A QR encodes one payload; multiplexing breaks scanners. |
