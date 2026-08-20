# collapse-pairing-into-gateway

## Why

Device pairing is implemented **twice**, on two settings surfaces, from one
server protocol. The two implementations have drifted, and the copy that
drifted is the one a security-minded operator is most likely to trust.

```
        GET /api/pair/payload  →  { v, id, code, urls[] }   (TLS-only urls)
        POST /api/pair/approve ←  typed compare-code (D12)
                    │  ONE server-side protocol
        ┌───────────┴────────────┐
        ▼                        ▼
  Settings ▸ Security      Settings ▸ Gateway  +  toolbar Gateway dialog
  PairingView.tsx          GatewayPairQR.tsx
  296 lines                419 lines
```

### The two surfaces are not equivalent

| | `GatewayPairQR` (Gateway) | `PairingView` (Security) |
|---|---|---|
| QR content | `https://<ep>/pair#pi:pair:v1.…` deep link | bare payload |
| phone camera can act on it | yes | **no** |
| encoder | shared `lib/pairing/pairing-qr.ts` | private local `encodePayloadString` |
| endpoint choice | explicit selector, pairing + link split | implicit |
| `guardPairingUrls` re-guard | yes | **no** |
| Approve at TTL zero | usable | **disabled** |

The last row is a spec violation. `qr-device-pairing` → *"Advisory countdown does
not gate approval"* requires the Approve control to remain usable when the
countdown reaches zero, because a redeeming device restarts the TTL server-side
and the server is the sole authority on validity.

```
GatewayPairQR.tsx:217   disabled={approving || !confirmCode.trim()}             compliant
PairingView.tsx:~275    disabled={approving || !confirmCode.trim() || expired}  violates
```

So the Security surface hands the operator a QR their phone ignores, and then
refuses the approval the server would still have accepted.

### Reachability makes it worse, not better

```
toolbar Gateway button  →  1 CLICK from every screen  →  GatewayPairQR
Settings ▸ Gateway      →  2 clicks, QR near top      →  GatewayPairQR
Settings ▸ Security     →  3 clicks + scroll past 4 OAuth blocks
                           and the trusted-networks editor  →  PairingView
```

`GatewayPage` and `GatewayDialog` both render an **"Open Security →"** link.
Security has no link back. The only navigational pressure in the product pushes
an operator *from* the working pairing surface *toward* the broken one.

### Why collapse rather than fix twice

The two surfaces already own different halves of the problem, and the code says
so. Security owns the **durable** half — `PairedDevicesSection` (list, last-seen,
revoke), OAuth providers, trusted networks. Gateway owns the **transient act** —
"get this device onto this road", which is what pairing is.

Pairing also cannot happen without the Gateway: the payload is TLS-only, and
`GET /api/pair/payload` returns `no_reachable_endpoint` with no secure road. A
pairing surface that lives away from the endpoint it pairs over is
structurally a second copy of the Gateway surface, and will drift again.

Keeping both means fixing four defects twice and re-fixing them on every future
pairing change. Collapsing removes the defects by removing the duplicate.

## What Changes

- **Settings ▸ Security ▸ "Pair a device"** becomes a link to
  the Gateway **"Connect a device"** surface. (Not "Access & QR" — that is the
  *dialog tab* label, and the Gateway settings page has no tabs; see D1.) No QR,
  no copy-string, no approve box on Security.
- **`PairingView.tsx` and `PairingView.test.tsx` are deleted.** `SettingsPanel`
  renders the link inline.
- **Four behaviours are ported up before the delete**, so the spec does not
  regress. `GatewayPairQR`'s empty state currently states the problem in one
  sentence; `PairingView`'s empty state also offers a *Set up the Gateway*
  action and the `http://localhost` escape-hatch note, both of which
  `qr-device-pairing` requires. `PairingView` also renders the **full**
  fingerprint `id` and the payload's **`urls[]`**, where the survivor shows a
  12-char prefix and a list of *gateway endpoints* (a different source). All
  four move to `GatewayPairQR` — see D3 and D7.
- **The port target is a CONDITION, not a block.** The explanation, action and
  localhost note must render whenever `GET /api/pair/payload` returned
  `no_reachable_endpoint` — not only in `GatewayPairQR`'s `state === "empty"`
  branch, which requires *zero endpoints of any kind*. On a link-only (http
  LAN/mesh) deployment the payload errors while `state` stays `"ready"`, and
  today only `PairingView` covers that journey. Porting into the empty-state
  block alone would ship a silent regression on the most ordinary LAN setup.
  See D3.
- **The Gateway → Security cross-link stays and gains a partner.** Security
  → Gateway is the new link, making the relationship bidirectional and each
  direction meaningful: Gateway sends you to Security for *who is trusted*,
  Security sends you to Gateway for *pair a device*.
- **`QrCodeDialog.tsx` + `QrCodeDialog.test.tsx` are deleted.** No component
  imports it; `TunnelButton` stopped opening it when `add-tunnel-providers`
  introduced `GatewayDialog`, and only its own test kept it alive. Its
  `AGENTS.md` row still describes it as the live tunnel-URL QR, and
  `PairingView`'s header comment cites it as the canonical `qrcode` idiom —
  documentation pointing at unreachable code. (`TunnelButton.tsx.AGENTS.md` also
  names it, in an immutable `See change:` history note; that stays.)
- **One pairing-QR encoder survives**: `lib/pairing/pairing-qr.ts`. The private
  `encodePayloadString` in `PairingView` disappears with the file.

## Impact

- Affected specs: `qr-device-pairing` (MODIFIED — the operator pairing surface
  is named; ADDED — single implementation, Security routes to it)
- Affected code:
  - `packages/client/src/components/connectivity/PairingView.tsx` (deleted)
  - `packages/client/src/components/__tests__/PairingView.test.tsx` (deleted)
  - `packages/client/src/components/connectivity/QrCodeDialog.tsx` (deleted)
  - `packages/client/src/components/__tests__/QrCodeDialog.test.tsx` (deleted)
  - `packages/client/src/components/settings/SettingsPanel.tsx` (link replaces `<PairingView />`)
  - `packages/client/src/components/Gateway/GatewayPairQR.tsx` (empty state gains the action + localhost note)
  - i18n catalogues (`settings.pairDevice` remains; `PairingView`-only keys retire)
  - directory `AGENTS.md` rows for `connectivity/` and `Gateway/`
- **No server change.** `GET /api/pair/payload` and `POST /api/pair/approve` are
  untouched; this is a client-surface collapse.
- **No shell change.** `packages/shell/src` contains zero references to
  `/settings/security` — the Electron shell only ever routes to `/pair`.
- Behaviour an operator loses: nothing, **once the four ports in D3/D7 land**.
  Every capability Security offered then exists on Gateway, in a compliant and
  camera-scannable form, one click from any screen. Without those ports the
  claim is false in three places — which is why they are phased before the
  delete, not after it.
- **One accepted regression in failure behaviour.** `PairingView` depended only
  on `GET /api/pair/payload`; `GatewayPairQR` additionally calls
  `getGatewayEndpoints()` and fails the whole surface if that throws. After the
  collapse there is no second surface to fall back to. Recorded in D8 and pinned
  by a test rather than fixed here.

## Discipline Skills

- `security-hardening` — the change moves a trust-establishing act between
  surfaces. The review must confirm the TLS-only `urls[]` guard, the one-time
  code's fragment placement, and the D12 typed-compare-code approval are all
  intact on the surviving surface, and that no pairing affordance survives on a
  path that skips `guardPairingUrls`.
- `doubt-driven-review` — deleting a security-labelled UI is close to
  irreversible in operator muscle memory. Stress-test the claim that Security
  loses no capability before the delete lands.
- `review-code` — non-trivial deletion across four files plus two i18n
  catalogues.
- `code-simplification` — the change is net-negative lines by design; the pass
  confirms the remaining surface did not absorb accidental complexity from the
  ported empty state.
