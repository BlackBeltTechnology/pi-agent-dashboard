## Why

Getting another device into this dashboard (or this UI onto another machine) is spread over six surfaces: the toolbar QR button, the 3-tab Gateway dialog (Setup / Access & QR / Security), Settings ▸ Network (Remote Servers, Gateway, Security, Access), Settings ▸ Server (listen interface) and the server dropdown. The tabs mirror the implementation, not the operator's intent ("share it", "let my phone in", "open it on the LAN"), and the dependencies between steps (a pairing QR needs a TLS road; LAN needs a non-loopback bind **and** `pairing.acceptLanRequests`) are discovered by failure. The dialog also renders a confident "Off" for the LAN switch while its data is still loading.

## What Changes

- **Toolbar entry** — the `mdiQrcode` Gateway button becomes a **Remote access** button with the `mdiAccessPointNetwork` glyph, a state dot (this computer only / network / internet / partial / failed) with the same state as text, and a waiting-request count badge; click always opens the dialog.
- **Status landing** — the dialog opens on "who can reach this machine right now": one row per road (This computer, Devices on my network, Internet), paired-device count, waiting requests, a warning when networks bypass authentication. Below it, four task entries.
- **Four scenario wizards** sharing one step engine:
  1. *Share over the internet* — provider (zrok recommended; ngrok, tailscale, zerotier) → install → enable → public address (zrok; or a temporary address) → go online → who may enter.
  2. *Let a phone or laptop in* — if no road is on, asks "same Wi-Fi or anywhere?" and inserts the LAN or share steps; then QR / link → approve in the app-wide approval dialog → paired.
  3. *Allow devices on my network* — listen on all networks (`0.0.0.0`, restart, resume) → accept LAN requests → who may enter.
  4. *Connect to another machine* — pick or type a server (added to known servers) → reachability probe → request access on that machine → open it.
- **Step skipping** — every step has a satisfaction check over existing state (readiness, `tunnel.*`, live bind host, `pairing.acceptLanRequests`, trusted networks). A satisfied step renders collapsed with a check and its value, and stays re-openable; runs of 2+ fold into one row. Steps that don't apply are omitted.
- **"Who may enter" is derived** — satisfied only when no non-loopback network is admitted without authentication; a sign-in provider is not a substitute.
- **No stale states** — every control shows a loading state until its source has loaded; read failures show "unknown".
- **Settings ▸ Network stays the expert view.** Wizard steps and settings pages compose the same section components, so they cannot drift.
- **Aligns with in-flight changes** — the Approve step relies on the approval dialog's remedies from `fix-pairing-approval-credential`; the denied-device Request access bar of `retire-trusted-networks-bypass` is referenced on the board, not implemented here.
- Mockup: mockups/remote-access.html (in this change); plan in `mockups/ui-plan.md`.

**Depends on:** `fix-pairing-approval-credential` landing first (its approval-dialog remedies are what the Approve step relies on).

## Non-goals

- No new server routes, config keys, trust rules or admission changes — the wizard drives existing endpoints (`/api/config`, `/api/restart`, `/api/tunnel-*`, `/api/pair/*`, `/api/known-servers*`).
- Settings ▸ Network pages are not removed or restructured beyond reusing shared sections.
- Electron server-window behaviour is unchanged; the "connect to another machine" wizard ends in the existing server switch.

## Capabilities

### New Capabilities
- `remote-access-wizard`: status landing, scenario entries, step engine with satisfaction checks and skip rendering, road inference for "let a device in", loading-state and operator-authority rules, connect-to-another-machine flow.

### Modified Capabilities
- `qr-code-dialog`: toolbar button glyph/state/badge, status reads, and click target (opens the Remote access dialog landing instead of the tabbed Gateway dialog); QR moves into the device task; disconnect and settings link move to the landing.
- `tunnel-provider`: readiness is read on dialog open and on return to the landing, and polled only while a provider-dependent step is current; the toolbar indicator follows the Remote access states; setup-by-readiness covers the wizard's provider steps and the Gateway page.
- `qr-device-pairing`: the one operator pairing view is rendered by the Gateway page and the wizard's device step (no toolbar Gateway dialog).

## Discipline Skills

- `security-hardening` — the wizard writes the bind host and LAN-request settings and restarts the server; every step must state its exposure consequence before it is applied, and refuse cleanly without operator authority.
- `doubt-driven-review` — the step-skip predicates decide what the operator never sees; review them before they stand.
- `review-code` — before commit.

## Impact

- Client: `components/connectivity/TunnelButton.tsx`; `components/Gateway/GatewayDialog.tsx` deleted and replaced by `components/remote-access/RemoteAccessDialog.tsx`; reuse of `GatewayReadinessBoard`, `GatewayProviderSection`, `GatewaySetupGuide` (split per step), `GatewayReservedName`, `GatewayConnectToggle`, `GatewayPairQR` (endpoint filter, LAN-switch panel extracted); `GatewayPage` gains the readiness board, reserved name and degraded banner that lived only in the dialog; new `lib/remote-access/`; `lib/gateway/gateway-connection.ts` indicator; i18n keys under `remoteAccess.*`.
- Tests: five `tests/e2e/gateway-*.spec.ts` / `zrok-v2-tunnel.spec.ts` specs and `TunnelButton.test.tsx` ported off the removed tabs.
- Server: none.
