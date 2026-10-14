## Why

Today the browser relay can drive only the Chrome **on the dashboard host**. The stock Playwright extension dials only a loopback relay (upstream `microsoft/playwright` `packages/extension/src/ui/connect.tsx:61`, recorded in `docs/research/browser-relay-playwright-extension.md` §2), and both relay endpoints admit only genuinely-local peers.

When the operator works on another machine, the agent drives the wrong browser. Example: Electron on mac-home switched to the MacBook's dashboard. The browser driven is the MacBook's, which has the wrong cookies, accounts and SSO state, while the operator's own logged-in Chrome sits unused.

The 2026-10-14 spike (`mockups/browser-relay/spike-remote-electron.md`, section "Spike D") proved a way that needs no extension fork:
1. A loopback relay shim on the **operator** machine accepts the stock extension.
2. The shim tunnels the extension stream to the dashboard server.
3. The server attaches the stream as if it came from a local extension.

Measured: handshake in ~1 s through the tunnel; the agent saw the operator's signed-in Google account; CDP round trip 185–355 ms on the LAN; pane clicks worked.

## What Changes

- **Operator browser hosts (new).**
  - The Electron main window, while its in-page server switch points at a dashboard (trusted local-origin renderer), registers on that server as an *operator browser host*.
  - Identity is an Ed25519 key pair held by Electron main. `hostId` is derived from the public key. Registration is challenge-signed, and the server pins the key on first use, so another client cannot take over a host.
  - Nothing ever supersedes a live host.
  - The server lists hosts in `GET /api/browser/profiles` under `operatorHosts`.
- **Connect on an operator host.**
  - `POST /api/browser/connect` accepts an optional `host`. Omitted, it targets the dashboard host exactly as today.
  - For an operator host, the server mints the guid as today and a separate `linkId`, then asks that host (unicast) to open the connect page.
  - Consent (up to 60 s) and the existing 60 s handshake are separate windows. The server cancels any connect it abandons.
  - The extension dials the Electron shim on `127.0.0.1`. The shim streams frames over the carrier `/ws` as `browser_host_ext_*` messages.
  - The server attaches that stream as the instance's extension socket. The agent's `cdpUrl` is unchanged: loopback on the dashboard host.
  - The guid never leaves the server; only the `linkId` does.
- **Consent and token stay on the operator machine.**
  - The first connect for a (server, profile) pair shows a native Electron dialog (Allow once / Always allow / Deny). "Always" is remembered until revoked.
  - A per-profile pairing token can be stored Electron-locally (`safeStorage`) for a zero-dialog extension handshake. It is never sent to the server.
- **Local live view.** When the pane viewing an operator-hosted tab runs in that same operator window:
  - Electron main tees that tab's screencast frames straight to the pane, and the server sends that socket no frames.
  - The server still acks frames and keeps the model.
- **Lifecycle.** Closing the carrier socket closes every instance hosted through it: window closed, reload, server switched away, network lost. A congested carrier fails loud: links close with 1013 instead of buffering without limit.
- **Agent recipe.** `references/dashboard-relay.md` documents `host`. It is passed only when the server advertises `operatorHosts: true`, so an old server is never silently driven against its own Chrome. The recipe also lists the new errors.

Non-goals (v1):
- Electron server windows that load a remote origin (untrusted renderer per VD5). These need a main-process carrier using the keyring bearer; that is a follow-up.
- Plain browsers (no Electron main).
- `allowedDomains` for operator-hosted profiles.
- Acking frames on the operator machine.
- Settings UI beyond a "This computer" token/consent block.
- Pin management UI (v1 offers only `DELETE /api/browser/operator-hosts/<hostId>`).

## Capabilities

### New Capabilities

- `browser-operator-host`: server and plugin side of operator browser hosts: registration, host-targeted connect, the virtual extension socket fed by `browser_host_ext_*`, the `linkId`↔guid mapping, local-frame suppression, limits, audit and lifecycle.
- `electron-browser-host`: Electron main side: the loopback relay shim, the trusted-renderer IPC surface, consent memory, the safeStorage token store, the local Chrome profile listing and launch, and the local frame tee.

### Modified Capabilities

- `browser-relay`: "Extension dials in on a per-connection relay endpoint" (operator-targeted guids are claimed only by the link), "Per-session isolation via tab groups" (busy keyed by host), "Audit trail" (`host:<hostId>`), "Profile discovery and capability" (`operatorHosts`), "Connect and CDP-URL lifecycle" (optional `host`), "Screencast tap for dashboard viewers" (local viewers get no frames; `host` in status).
- `default-browser-skill`: "Dashboard-relay recipe for logged-in browsing" documents `host` (only with `operatorHosts: true`) and the new errors. A dashboard host without Chrome no longer halts when an operator host can serve.
- `shared-protocol`: new `browser_host_*` message contracts and their WS tiers; `local` on subscribe; `host` on status instances.
- `browser-plugin-settings` (ADDED requirement): the "This computer" block (Electron only).
- `browser-pane-tab`: "One pane tab per relay tab" (local subscribe + local frames on the operator machine).

## Impact

- `packages/browser-plugin/src/server/`:
  - new `operator-hosts.ts` (registry + carrier handlers) and `relay/link-socket.ts` (a `RelaySocket` over the carrier);
  - `relay-manager.ts` gains a host-targeted connect;
  - `routes.ts`, `status.ts`, `audit.ts` gain host fields.
- `packages/browser-plugin/src/client/`: new always-mounted `OperatorHostCarrier` (Electron only); `BrowserPaneTab` local-frame path; `BrowserSettings` "This computer" block.
- `packages/shared/src/`:
  - `browser-protocol.ts` `browser_host_*` types;
  - `ws-message-tiers.ts` entries;
  - new pure `chrome-profiles.ts` (Local State parsing + extension-installed check + Chrome open argv), shared by the plugin and Electron.
- `packages/electron/src/`: new `lib/browser-host/` (shim, consent store, token store, IPC); `preload-main.ts` exposes `window.piDashboard.browserHost`, trusted local-origin senders only.
- `packages/extension/.pi/skills/browser/references/dashboard-relay.md`.
- **Compatibility:**
  - No change for callers that omit `host`.
  - The new response fields are additive.
  - An old Electron never registers.
  - The carrier registers only when `GET /api/browser/status` advertises `operatorHosts: true`, so it never sends `browser_host_*` to an older server. That matters because an unknown type falls through the gateway's `default:` branch rather than being dropped.
- **Rollback:** revert. Hosts are in-memory only; consent and token files live on operator machines and are ignored by older builds.

## Discipline Skills

- `security-hardening`: the extension stream crosses the network; the server instructs the operator's main process to launch Chrome; the carrier messages are untrusted input on both ends; pairing tokens are stored.
- `doubt-driven-review`: a new wire protocol and a public REST field (`host`) are hard to change once Electron builds ship.
- `observability-instrumentation`: a new external path (operator link). Connect latency, link open/close and refusals need log lines and audit entries.
- `performance-optimization`: screencast bandwidth over the carrier and the local frame tee. The spike measured 1.9 fps / ~18 KB frames as "laggy".
- `review-code`: the normal pre-commit checkpoint.
