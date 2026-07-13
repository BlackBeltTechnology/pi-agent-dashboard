# Add Gateway QR network selector (one scannable QR at a time)

## Why

The Gateway → **Access & QR** view (`GatewayPairQR.tsx`) renders **every** QR at
once: one pairing QR for the TLS tunnel PLUS one link QR per no-TLS endpoint
(localhost + each LAN address). A real deployment shows 4–5 QR codes stacked on
one screen. A phone camera cannot lock onto a single code in a grid — it hunts,
focuses on the wrong one, or decodes a neighbour. The wall of codes also buries
the primary path (the public tunnel) among secondary LAN links.

The transport split is correct and stays (D1/D14: TLS → pairing payload, no-TLS
→ bare-URL link QR). Only the **presentation** is wrong: many QRs at once.

## What Changes

Replace the multi-QR wall with a **single QR driven by a network selector**:

- The endpoint mini-list becomes a **radio group** — one selectable row per
  destination, each carrying its existing `kind` pill (PUBLIC / LOCAL / LAN) and
  a mode tag (`pairing` vs `link`).
- Exactly **one QR** renders at a time, for the selected row.
- **Default selection = the public tunnel** (the TLS pairing endpoint). When no
  TLS endpoint exists, default falls to the first available link endpoint.
- The context panel below the QR **swaps by selected kind**:
  - **pairing** (TLS tunnel) → one-time countdown + fingerprint + `pi:pair:v1.…`
    copy-string + "type the confirmation code" + Approve (unchanged pairing flow).
  - **link** (no-TLS LAN/local) → the bare URL + "opens the dashboard directly,
    no pairing, no secret" note. No copy-string, no confirmation, no expiry.

No change to the pairing protocol, the transport gate, `splitEndpoints()`, or the
`/api/pair/payload` / `/api/tunnel/endpoints` contracts. This is a client-only
presentation refactor of one component.

## Impact

- **Spec:** `tunnel-provider` — MODIFY "Pairing-QR transport gate and link QR" to
  require single-QR-at-a-time presentation via a selector (tunnel default). The
  transport gate and link-QR-carries-no-secret guarantees are unchanged.
- **Code:** `packages/client/src/components/Gateway/GatewayPairQR.tsx` (the only
  file). Helpers `splitEndpoints` / `guardPairingUrls` reused as-is.
- **Tests:** component tests for default-selection, QR-count-is-one, kind-swap of
  the context panel, and empty-tunnel fallback.
- **Behaviour preserved:** D14 (only TLS rides the pairing QR), link QRs carry no
  secret, typed compare-code approval.

## Discipline Skills

- `accessibility-a11y` — the selector is a keyboard-navigable radio group (arrow
  keys, roving tabindex, `aria-checked`), replacing static QR tiles.
