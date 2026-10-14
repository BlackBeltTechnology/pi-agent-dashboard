## Context

Evidence: `mockups/browser-relay/spike-remote-electron.md`, sections "Topology" and "Spike D". Throwaway scripts: `mockups/browser-relay/spike-d/{shim,bridge,pipe}.mjs`. The spike proved the stock Playwright extension attaches through a loopback shim on the operator machine plus a tunnel. No relay or extension change was needed.

Existing code this design builds on (`develop`; paths under `packages/browser-plugin/src/server/` unless stated):

- **Relay transport.** It is an interface: `RelaySocket {readyState, bufferedAmount?, send, close, on}` (`relay/extension-socket.ts:20-27`). `RelayManager.attachExtension(guid, ws)` claims the guid and hands the socket to the instance (`relay/relay-manager.ts:370-382`). Connect mints the guid, opens Chrome and awaits the handshake for up to 60 s (`relay-manager.ts:188`, `:240-242`). Busy = a live instance on the same `profileDirectory` unless `allowMultipleInstancesPerProfile` (`relay-manager.ts:212`).
- **Extension → relay events.** They arrive as `[source{tabId, sessionId?}, method, params]`. Top-level tab events carry `source.tabId` and no `sessionId` (`relay/relay-instance.ts:438-439`). The relay's model synthesizes its own CDP session ids for the agent (`relay/vendor/playwright-core/src/tools/mcp/browserModel.ts`). These never reach the extension side.
- **Pure helpers.** `buildConnectUrl` (`connect.ts:48`), `buildChromeOpenCommand` (`capability.ts:68`), `listChromeProfiles` (`profiles.ts:107`). The last checks `installed` with the vendored `isExtensionInstalledInProfile` (`profiles.ts:24`, `:116`).
- **Screencast.** Frames go to viewer sockets one by one, never broadcast (`relay/screencast-tap.ts:245`). Acks are immediate and unconditional (`screencast-tap.ts:232`).
- **Plugin WS handlers.** They are registered with `ctx.registerBrowserHandler` (`status.ts:143`). An unregistered type falls through to `handlePiGatewayForward` (`packages/server/src/pairing/browser-gateway.ts:2417-2424`).
- **WS tiers.** `browser_relay_input: "operate"` (`packages/shared/src/ws-message-tiers.ts:103`). Unlisted types are gated at `operate` (`packages/server/src/pairing/browser-gateway.ts:1943-1946`, via `wsMessageTier` in `ws-message-tiers.ts`).
- **Electron trust.** The main-window preload exposes `window.piDashboard` (`packages/electron/src/preload-main.ts:70-88`) and already gates one capability (`openServerWindow`) on the local origin (`preload-main.ts:83-86`). Privileged IPC accepts only the local loading page or the loopback origin on the configured port (`packages/electron/src/lib/ipc-trust.ts:27-46`). The in-page server switch keeps the main window on its local origin and changes only the WS target (`packages/client/src/lib/api/server-switch.ts:71`). A reload falls back to the local server (`server-switch.ts:23-34`). Observed live: mac-home's carrier socket on the MacBook logged `origin=http://localhost:8000`.

## Goals / Non-Goals

**Goals:**
- An agent on dashboard host S drives Chrome on operator machine O with the stock extension, only with O's consent.
- `cdpUrl` and the agent tooling are unchanged.
- No guid, pairing token or host private key leaves its owner.
- The live view on O does not round-trip frames through S.

**Non-Goals:**
- Server windows loading a remote origin (VD5; follow-up with a main-process carrier using the keyring bearer).
- Plain browsers.
- `allowedDomains` for operator profiles (operator instances get the deny-list only).
- Acking frames on O.
- Final consent/settings copy (pending UX board).

## Decisions

### D1 — Carrier = the trusted main-window renderer's existing `/ws`

Electron main hosts the shim and the host identity. The bytes travel over the dashboard SPA's own authenticated `/ws` to S. An always-mounted plugin client component, `OperatorHostCarrier`, bridges `window.piDashboard.browserHost` IPC ↔ `browser_host_*` WS messages.

`browserHost` is exposed only when the window is on its local origin, mirroring `preload-main.ts:83-86`. The IPC is also refused by `ipc-trust.ts`. So a remote-origin window (VD5) has no `browserHost` and never becomes a carrier.

- *Why not a main-process WS?* In the in-page switch mode main holds no credential for S; mac-home has no server keyring.

### D2 — Host identity is a key pair; S pins it on first use; nothing supersedes a live host

- **Identity.** On first use, Electron main generates an Ed25519 key pair. `hostId` = `host-` + 32 hex of SHA-256(public key). The private key is stored with `safeStorage`; without encryption it is held in memory only, and a fresh identity is used next launch. It never leaves main.
- **Registration.**
  1. The carrier first checks `GET /api/browser/status` for `operatorHosts: true`. Without it, nothing is sent: an unknown type would otherwise fall through `browser-gateway.ts:2417-2424`.
  2. It sends `browser_host_hello {hostId, publicKey}`.
  3. S replies `browser_host_challenge {nonce, serverId}`: 32 random bytes, plus S's own `/api/health` `instanceId`.
  4. Main checks that `serverId` equals the `instanceId` it fetched from the switched-to target (D7), then signs `"pi-browser-host-v1\n" + nonce + "\n" + serverId`.
  5. The carrier sends `browser_host_register {hostId, signature, label, platform, canOpenChrome, profiles}`.
  6. S verifies the signature against the pinned public key, using its own `instanceId`. Binding to S's identity rather than an origin string keeps verification stable behind tunnels, proxies and IP-vs-name access. The first verified key for a `hostId` is pinned in the plugin data dir (`operator-hosts.json`); a different key for that `hostId` is refused. S then answers `browser_host_registered {hostId}`.
- **Binding.** One host per socket. A verified register for a `hostId` currently bound to another live socket is refused (`host-active`) while that socket has live links or pending connects; otherwise it re-binds and the old binding is dropped. No live instance is ever closed by a newcomer.
- **Reading `hostId` is harmless.** `hostId` appears in `GET /api/browser/profiles`, but a client cannot register it without the private key.
- **Pin reset.** `DELETE /api/browser/operator-hosts/<hostId>` removes the pin, for a reinstalled operator. It uses the same REST auth as every `/api/browser/*` route, with tier `operate` listed explicitly in `packages/shared/src/route-tiers.ts` (the default is also `operate`, `route-tiers.ts:450-451`).
- **Pin growth.** Pins unseen for 90 days are pruned, and at most 256 are kept (least recently seen dropped). This bounds the dead pins left by machines without `safeStorage`, which mint a fresh identity each run.
- **Liveness.** A half-open carrier is terminated by the gateway's existing keepalive after 2 missed pongs (`packages/server/src/pairing/browser-gateway.ts:610-630`). Its close then frees the host, so a zombie cannot hold `host-active` indefinitely.
- **Bounds.** `label` ≤ 128 chars; ≤ 64 profiles; `profileDirectory` ≤ 128 chars with no path separators; `email` ≤ 254. Violations are dropped and audited.

### D3 — `linkId` replaces the guid on the wire; connect and link are bound to one socket

- For an operator connect, S mints the guid as today and a separate 128-bit `linkId`, keeping `linkId → {guid, requestId, socket}` server-side.
- S sends `browser_host_connect {requestId, linkId, instanceId, profileDirectory, serverLabel}` to the bound socket only. `serverLabel` = S's host:port as S knows it, display only.
- S accepts `browser_host_connect_result`, `ext_open`, `ext_data` and `ext_close` for that `linkId`/`requestId` only from that socket.
- `ext_open` is accepted only after `connect_result {ok: true}`; earlier ones are dropped and audited.
- The guid never leaves S.

### D4 — Timers: consent and handshake are separate windows; S cancels what it abandons

| window | bound |
|---|---|
| consent | Main's dialog auto-denies after 55 s. S waits up to 60 s for `connect_result`; none → 504 `{reason: "consent-timeout"}`. |
| handshake | S's existing 60 s handshake timer starts at `connect_result {ok: true}`, not at the request. |

The REST request stays open for the whole duration; its socket timeout is disabled per `fix-browser-relay-pane-input` D2, which lands first.

Whenever S abandons a connect (any non-200 outcome after `browser_host_connect` was sent), it sends `browser_host_connect_cancel {requestId}`. Main then:
- closes the dialog if open;
- unregisters the `linkId` from the shim;
- closes any extension socket on that link.

### D5 — `LinkSocket` is a `RelaySocket` over the carrier

`relay/link-socket.ts` implements `RelaySocket`:
- `send(data)` → `browser_host_relay_data {linkId, data}` (server→browser name, distinct from the browser→server `browser_host_ext_data`);
- `close` → `browser_host_relay_close {linkId, code, reason}`;
- `bufferedAmount` = the carrier socket's;
- `on("message"|"close")` is fed by inbound `browser_host_ext_data` / `ext_close` and by carrier close.

The vendored relay, the deny-list, the screencast tap and the audit are unchanged.

Limits:
- One `data` ≤ 16 MiB, else the link closes with 1009.
- ≤ 8 links and ≤ 2 pending connects per host (else 409 `host-busy`).
- A pending connect for the same (host, profile) → 409 `busy`.
- Carrier `bufferedAmount` > 32 MiB for 10 s → every link on it closes with 1013 `carrier-congested`. Extension traffic cannot be skipped like viewer frames, so congestion fails loud rather than growing memory.

### D6 — Host-targeted connect outcomes

`POST /api/browser/connect` gains optional `host`. Omitted or `"dashboard"` → today's path, unchanged.

| outcome | response |
|---|---|
| relay disabled (kill switch) | 403, as today |
| `host` not bound to a live socket | 404 `{reason: "unknown-host"}` |
| profile not in the host's rows, or `installed: false` | 409 `{reason: "not-installed"}` |
| live instance or pending connect on (host, profile) | 409 `{reason: "busy", instanceId?}` |
| ≥ 8 links or ≥ 2 pending connects on the host | 409 `{reason: "host-busy"}` |
| `connect_result {ok:false, reason:"denied"}` | 403 `{reason: "operator-denied"}` |
| `connect_result {ok:false, reason:"no-chrome"}` | 503 `{reason: "no-chrome"}` |
| `connect_result {ok:false, reason:<other>}` | 503 `{reason: "launch-failed"}` |
| no `connect_result` within 60 s | 504 `{reason: "consent-timeout"}` |
| carrier closed before the handshake | 503 `{reason: "host-gone"}` |
| no handshake within 60 s of `ok: true` | 504, as today |
| handshake completes | 200 `{cdpUrl, instanceId}` (loopback `cdpUrl` on S) |

Busy is keyed (host, `profileDirectory`), so the dashboard's and an operator's `Default` profile never collide.

Operator instances use only the relay deny-list. Server `plugins.browser.browsers.*` (token, `zeroDialog`, `allowedDomains`) applies to dashboard-host profiles only.

**Version skew.** An old server ignores the `host` field and would drive its own Chrome. The agent recipe therefore passes `host` only when `GET /api/browser/status` reports `operatorHosts: true`.

### D7 — Consent and token live on O, keyed by the real target server

- **Server key** = the WS target origin the renderer is switched to, which the carrier passes to main, plus that target's `/api/health` `instanceId`. Main fetches the instanceId itself from the target with Node fetch, the same way as `remote-probe.ts`; the page origin is not used, because in-page switch the page is always local. A new `instanceId` (re-paired or reinstalled server) asks again.
- **Dialog.** Native, parented to the main window. Text: "*<serverLabel>* wants an agent to control Chrome profile *<label>* on this computer." Buttons: Allow once / Always allow / Deny. Default and Escape = Deny. 55 s auto-deny.
- **Storage.** "Always" goes to `browser-host-consent.json` in userData (owner-only permissions where the OS supports POSIX modes). An unreadable file is renamed `browser-host-consent.corrupt-<ts>.json` and treated as empty.
- **Revoke.** "This computer" block and the app menu "Browser relay → Revoke all" remove stored consents. Revoking affects future connects only; live instances are not closed.
- **Token.** Per profile, stored with `safeStorage` only (memory-only fallback, the same rule as `server-keyring.ts`). Appended to the connect URL locally and never sent to S.
- **Two token stores, disjoint by host.** The server token applies to dashboard-host profiles; the Electron token applies to that operator machine's profiles.

### D8 — Profiles and Chrome launch from shared pure helpers

`Local State` parsing, the pinned-extension installed check (`<profile>/Extensions/mmlmfjhmonkocbjadbfplnigmagldckm` exists) and `buildChromeOpenCommand` move to `packages/shared/src/chrome-profiles.ts`. The plugin re-exports its existing names, keeping the vendored check as its implementation; a parity test runs both on the same fixtures. Electron consumes the shared helpers.

The operator profile rows registered with S carry only `{profileDirectory, label, email?, installed}`. S adds `instances` itself. Operator rows carry no `hasToken`/`zeroDialog`, because S cannot know Electron-local state.

### D9 — Electron IPC surface is narrow, trusted-sender only, and tied to one carrier

`window.piDashboard.browserHost`, local origin only, exposes:
- `identity()` → `{hostId, publicKey, label, platform, canOpenChrome, profiles}`;
- `sign(nonce, serverId)`;
- `onConnect(cb)`, `respondConnect`, `cancelConnect(requestId)`;
- `extSend(linkId, data)`, `extClose(linkId, code)`, `onExt(cb)`;
- `tee(linkId, instanceId, tabId, on)`, `onFrame(cb)`;
- `setToken(profile, token|null)`, `listConsents()`, `revokeConsent(key)`.

Each channel goes through `trustedHandler`/`trustedListener`.

When the main window's renderer navigates, reloads or is destroyed, main treats every pending connect as cancelled and closes every link. This is the same effect as `connect_cancel`; S sees the carrier close.

The shim:
- listens on `127.0.0.1:0`;
- accepts only `/ws/browser-ext/<linkId>` for a link that is registered (after Allow) and unclaimed, with `Origin: chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm`;
- allows one socket per link;
- answers 404 otherwise;
- closes when idle.

The Origin check is not authentication: a local process can forge it. The `linkId` is the credential (see Risks).

### D10 — Local frames: S sends none to the carrier; main tees by Chrome tab id

When `browser_host_registered` named this window's host and a pane tab views a tab of an instance whose `host` is that `hostId`, the pane subscribes with `local: true`. If the subscribing socket is the instance's carrier, S:
- counts it as a viewer (tap start/keep/stop, ack unchanged);
- never sends it `browser_relay_frame`;
- sends it `browser_host_tee {linkId, instanceId, tabId, on: true}`, and `on: false` when that viewer's subscription ends.

S keeps one subscription per (socket, tab), as today. Its mode (local or not) is that of the most recent subscribe from that socket. `tee {on: true}` is sent when the mode becomes local and `on: false` when it stops being local or the subscription ends; a mode switch never yields frames and tee at the same time.

Main copies every extension event on that link with `source.tabId === tabId`, no `source.sessionId`, and method `Page.screencastFrame` to `onFrame({instanceId, tabId, jpegBase64, metadata})`. It then forwards the event to S unchanged; S keeps acking.

`local: true` from any other socket is ignored and handled as a normal subscribe, audited as kind `denied` with detail `browser_host:local-ignored`.

### D10b — Unicast

Every server→browser `browser_host_*` message is sent only to the bound carrier socket and never broadcast. `operatorHosts[]` is served only by `GET /api/browser/profiles` (authenticated REST), never broadcast on `/ws`. `browser_relay_status` carries only `host` (the `hostId`).

### D11 — Observability

- **Log lines:**
  - `[browser-host] register host=<hostId> profiles=<n> pin=<new|ok|mismatch>`;
  - `[browser-host] connect host=<hostId> profile=<dir> outcome=<status|reason> ms=<n>` (once per connect);
  - `[browser-host] link close host=<hostId> reason=<reason>`.
- **Audit.** Host-level events are stored in the audit ring under profile key `host:<hostId>` (readable via `GET /api/browser/audit?profile=host:<hostId>`): pin mismatch, refused register, dropped `browser_host_*`, early `ext_open`, downgraded `local`. Instance `attach`/`detach` carry `host:<hostId>` in `detail`.
- No guid, `linkId`, nonce, signature, pairing token or frame data appears in logs, audit, status or REST bodies.

## Risks / Trade-offs

- **The `linkId` is visible in the Chrome launch argv on O** (`buildChromeOpenCommand`). A local process of the same user could race the extension to the shim. Mitigations:
  - the link is registered only after Allow;
  - it is single-use (first socket wins; the extension's failure then surfaces as a 504);
  - it lives at most 60 s;
  - same-user local processes are already inside the trust boundary of today's relay (the guid sits in argv on S in exactly the same way, per `connect.ts`'s module doc).
- **TOFU pinning.** The first registration of a `hostId` on S is trusted. An attacker who registers a fresh key pair gets a different `hostId` and cannot pose as the operator's existing one. The pin file is in plugin data; reset is explicit.
- **The carrier is the SPA socket.** Reload or switch drops every operator instance (the safe failure), and a reload returns to the local server (`server-switch.ts:23-34`). Chat/status bursts share the socket; D5's congestion rule fails loud.
- **Frames still go O→S** for ack and model; D10 saves only S→O. The spike's "laggy" verdict came from the full round trip; the remaining lag is measured in the test plan.
- **Driving the operator's Chrome is the feature.** Mitigations:
  - (server, profile) consent;
  - the extension's own Allow or token;
  - a coloured tab group;
  - the kill switch;
  - carrier close ends everything.
- **PII.** Host label (hostname) and profile emails are visible to authenticated dashboard clients over REST, the same exposure as dashboard-host profile rows today.

## Migration Plan

1. Land `fix-browser-relay-pane-input` first.
2. Ship server/plugin. With no registered host, behaviour is identical.
3. Ship Electron. Old server → no `operatorHosts: true` → no registration.
4. Old Electron → never registers.
5. Rollback = revert either side. Hosts are in memory, plus the pin file in plugin data, which older builds ignore. Electron state is local files that older builds ignore.

## Open Questions

- Final dialog and "This computer" copy, from the pending UX board (`mockups/browser-relay/`, retro-ux-browser-relay). Tests assert roles, test ids and button semantics, not strings.
