# Design — prove-vault-bridge-tls

## Context

See `proposal.md` — Why. Current state that shapes the approach:

- **Trust gate.** `decideVaultTrust({origin, tls})` admits hub-local, or a remote paired device when `tls` is true (`packages/server/src/vault/vault-delivery-hub.ts:36-42`).
  - `isTls` is never wired, so it is always false (`vault-delivery-hub.ts:85-86,211`; wiring at `packages/server/src/server.ts:1869-1880` passes no `isTls`).
  - The gate never consults the paired-device registry. A revoked device's still-connected session keeps its `origin.deviceId`.
- **Gateway transport.** TCP bridges reach a plain `ws` `WebSocketServer` on `piPort` (`packages/server/src/pi/pi-gateway.ts:1174`).
  - Every TCP upgrade passes `decideBridgeUpgrade` (`packages/server/src/pi/bridge-upgrade-auth.ts:108`). It is path-agnostic: a remote peer needs a single-use `bridge`-scoped ticket carrying the minting `deviceId` (`pi-gateway.ts:1170`).
  - Origin attribution drops that `deviceId` for any loopback peer (`packages/server/src/session/session-origin.ts:58-63`; `pi-gateway.ts:476-485`). So a remote device behind a local L4 forwarder (`ssh -L`, `tailscale serve`, socat) reads as hub-local. That blind spot is documented in `bridge-upgrade-auth.ts:127-135`.
  - Loopback TCP is also admitted by a legacy raw local token, or tokenless during the D10b grace (`requireTicketOnLoopback: false`, `server.ts:1300-1303`; `bridge-upgrade-auth.ts:157-175`). Each such bridge reads as hub-local and today receives hub vault delivery.
  - The TCP `WebSocketServer` runs `verifyClient` on every `handleUpgrade`. Only `unixUpgrades` requests skip it (`pi-gateway.ts:1122-1130`). The lazy `noServer` server attaches its handler with the `"unix"` label (`pi-gateway.ts:1272-1274`).
  - The in-process ACP connection has no upgrade request (`handleConnection(…, "local")`, `pi-gateway.ts:1266`).
- **Native TLS listener.** An optional `https.Server` (`tls.enabled`, default port `8443`, default host `127.0.0.1`) dispatches into the main Fastify instance and its named upgrade switch `onUpgrade` (`packages/server/src/tls/tls-listener.ts:233-234`; `server.ts:4656`).
  - Certificates are publicly trusted (Tailscale, ACME DNS-01).
  - `onUpgrade` already separates TLS sockets via `(socket as TLSSocket).encrypted` (`server.ts:4663`).
  - It refuses `scope === "bridge"` (`/ws/bridge`, `packages/server/src/auth/ws-ticket.ts:107`) with a 400 on both listeners (`server.ts:4791-4803`).
  - The "Reachable bind gate" forbids advertising TLS endpoints while the bind is loopback (`openspec/specs/dashboard-tls-listener/spec.md:213`).
- **Ticket mint.** `POST /api/ws-ticket` with `scope: "bridge"` needs an `operate`-tier paired-device bearer, or a genuinely-local caller (`server.ts:3462-3497`; `packages/server/src/auth/bridge-ticket-eligibility.ts:67-78`).
  - In the default topology the bridge mints from `http://<host>:8000` (`openspec/specs/pi-gateway-auth/spec.md:384-404`), before the identity challenge runs (`packages/extension/src/remote-upgrade-preparer.ts:75` mints; `bridge-handlers/lifecycle.ts:476` runs `gateRemoteRegistration`).
  - A `wss://` endpoint maps to an `https://` origin.
- **Bearer registry.** Opaque 256-bit base64url bearer; only its SHA-256 is persisted (`packages/server/src/pairing/paired-devices.ts:2-8,113,181`).
  - Load spreads every row (`...d`, `paired-devices.ts:140`), so unknown fields survive an older binary's rewrite.
  - Writes are `writeJsonFile` with no lock (`:147-148`).
  - Bearers are verified at:
    - the `bearer-auth` hook (`packages/server/src/auth/bearer-auth.ts:113,148`);
    - the bridge-mint eligibility (`server.ts:3484`);
    - the live-server strip checks (`server.ts:3365,4973`);
    - the plugin host services `verifyDeviceToken` / `verifyDeviceTokenTier`, used by the MCP plugin for `/mcp` (`server.ts:1728,1737`). These receive no request.
  - Bearers are handed out at:
    - QR/knock: the token is minted at `approve()` on the operator's request (`packages/server/src/pairing/pairing.ts:606`) and handed out later by `poll()` on the device's request (`:636-650`);
    - operator mint (`packages/server/src/routes/pairing-routes.ts:665`), used by the CLI `token create` through the local token;
    - rotation (`pairing-routes.ts:243` → `paired-devices.ts:314`).
  - Token prefixes already carry meaning: `pi_op_` (`packages/server/src/identity/break-glass.ts:24`).
- **Concurrent change.** `device-key-mutual-check` turns revoke into a held, restorable state in a separate file (`openspec/changes/device-key-mutual-check/proposal.md`). It also refuses all credentials of a held row.
- **Bridge.**
  - `ConnectionManager.openSocket` builds `ws` options (`packages/extension/src/connection.ts:988-996`).
  - The remote HTTP credential calls use global `fetch`: ticket mint (`packages/extension/src/bridge-ticket-client.ts:67`), identity challenge (`challengePinnedServer`, `packages/shared/src/server-pinning.ts`) and the pi-trust live query.
- **Forwarding headers** are a trust downgrade throughout the repo, never a credential (`openspec/specs/trusted-networks`, `openspec/specs/pi-trust-mirror`).

## Goals / Non-Goals

**Goals:**
- The hub admits a remote paired device only on evidence it observes itself.
- A bearer meant for vault use never leaves the bridge over plaintext. The hub refuses any bearer it has seen over plaintext.
- Deactivating a device (revoke, hold, expiry) withdraws its vault values from connected sessions within 5 s.
- A refused remote session says which proof is missing and how to fix it.

**Non-Goals:**
- **Proxy-terminated TLS** (zrok, cloudflared, Caddy in front of `:9999`, or any proxy that announces itself with a forwarding header) stays `transport-insecure`. A header-less, re-encrypting proxy that the operator deploys in front of `:8443`, holding its own trusted certificate for the name, cannot be told apart. It is part of the operator's trust path, not an attacker capability, because an attacker cannot present a trusted certificate (see the CA non-goal). Payload encryption to a device key is the only route for those topologies; it is not planned here.
- **TLS on the `piPort` gateway listener.**
- **Closing a revoked device's bridge sockets** (`pi-gateway-auth` / `device-key-mutual-check` own that).
- **Channel binding (RFC 9266).** Not needed while the bridge validates the certificate (D7).
- **A compromised or user-installed CA.** Explicit interpretation of C1: under standard TLS assumptions, an attacker that cannot present a certificate trusted by the bridge's CA set is the threat. A CA-trusted MITM is outside it, which is the same trust root as the browser.
- **Hostile code inside the bridge's own pi process** (it can read delivered env values anyway).

## Decisions

### D1: Proof = proven TLS channel + device-bound evidence, all observed by the hub

Remote trust needs every row of this table:

| Evidence | Observed at | Why needed |
|---|---|---|
| Upgrade on the native TLS listener with no forwarding header ("proven TLS", D3) | upgrade | Values and prompts travel encrypted end to end |
| Consumed ticket was minted on a proven-TLS request | `/api/ws-ticket` | The minting request carries the bearer |
| Device active, history tracked, bearer never seen off a proven channel (D4) | registry | A bearer sniffed earlier could mint over TLS |
| Bridge declares certificate validation enforced (D7) | register + sync request | Excludes honest-but-old/misconfigured bridges the hub cannot otherwise tell apart |

Hub-local delivery needs **local admission**: the unix socket, a valid local credential proof, or the in-process ACP connection. Loopback by address alone is not enough (legacy token, tokenless grace, deviceless ticket), because an L4 forwarder looks the same.

**Alternatives.**
- **Trusted-proxy `X-Forwarded-Proto`.** Rejected: any peer reaching the port can set the header, and it contradicts C6.
- **Payload encryption to an enrolled device key.** Rejected for now: new crypto and an enrollment problem, and it covers values only.

### D2: Bridges reach the pi gateway through the TLS listener at `/ws/bridge`, opt-in

- **Config.** New `tls.acceptBridges` (boolean, default `false`), validated in `validateTlsConfigWrite` (`packages/server/src/tls/tls-config-validation.ts`). It is shown as a switch in Built-in HTTPS. The bridge endpoint text is hidden while the bind is loopback; the `bind-reachable` fix is shown instead.
- **Routing in `onUpgrade`.** All of the following must hold before the upgrade is handed off:
  - `scope === "bridge"`;
  - the socket is a `TLSSocket`;
  - `tls.acceptBridges` is live-read true.

  Hand-off happens after host admission and the Origin gate, at the point of today's 400. The upgrade goes to a new `piGateway.handleTlsUpgrade(req, socket, head)`. Every other case keeps the 400 without consuming the ticket.
- **Auth in `handleTlsUpgrade`.** It runs `decideBridgeUpgrade` once, with these settings:
  - `transport: "tcp"`;
  - `requireTicketOnLoopback: true`;
  - `localCredential: "absent"`.

  It also **refuses a ticket with no `deviceId`**: the TLS path is for paired devices only. A bridge on the hub host must use its local socket.
- **Hand-off.** On success it adds the request to a `tlsUpgrades` WeakSet, sets `upgradeDeviceId`, and calls `wss.handleUpgrade`. `verifyClient` skips `tlsUpgrades` requests exactly as it skips `unixUpgrades`, so the single-use ticket is consumed once.
  - It targets only the gateway's **existing** `WebSocketServer`, created by `startTcp`/`startOnSocket`, which also runs the heartbeat. When none exists (the gateway has not started), it refuses with `503` and logs cause `tls-gateway-not-ready`. Nothing is created lazily, so the gateway's start order (`pi-gateway.ts:1103-1111`) is unaffected.
  - Per-connection transport derivation reads `tlsUpgrades` before the attach-time label, so it is never `"unix"`.
- **Named refusals.** Each TLS-path refusal is logged with its cause:
  - `tls-bridges-off` (the existing 400);
  - `tls-deviceless-ticket` (the ticket is consumed);
  - `tls-gateway-not-ready`;
  - the existing `decideBridgeUpgrade` causes.
- **Switching off withdraws.** When `tls.acceptBridges` or `tls.enabled` turns off, or the listener stops, the server closes every gateway socket whose admission arrived over TLS. Upgraded sockets are detached from the `https.Server`, so its `closeAllConnections()` does not reach them. It then calls `schedulePush()`. Trust also live-checks the switch for TLS channels (D5 step 7).
- **Attribution on this path.** A ticket-admitted TLS connection is attributed to the ticket's device as **remote**, whatever the peer address. A loopback forwarder in front of `:8443` cannot make it hub-local.
- **Opt-in** satisfies `pi-gateway-transport` "The non-loopback bridge listener is opt-in". Browser HTTPS and bridge admission are separate consents.

### D3: Channel record bound at register

- **Proven TLS** = `socket.encrypted === true` AND none of the headers in a dedicated `PROVEN_TLS_DISQUALIFYING_HEADERS` list. That list equals today's extended forwarding-header list (`localhost-guard.ts:41-45`, including `via`, `x-forwarded-server` and `x-forwarded-port`). The comment there that reserves the extended list for plugin scopes is updated to name this second owner.
- **The ticket store** records `mintedOnProvenTls` with the same predicate on `/api/ws-ticket` (`request.raw`). `consumeDetailed` returns it, plus the ticket's `deviceId`.
- **Ticket mint mode.** The ticket store also records `mintedBy: "device" | "local"`. `local` covers the genuinely-local, bearer-less mint (`bridge-ticket-eligibility.ts:71-73`).
- **Per socket**, the gateway stores `channel = { admission, provenTls, ticketTls, ticketDeviceId? }` at upgrade.
  - `admission` ∈ `unix` | `local-proof` | `in-process` | `device-ticket` | `local-ticket` | `legacy-token` | `grace`.
  - It is derived from the verdict and the consumption on **every** transport (unix, TCP `:9999`, TLS), so the `:9999` loopback-forwarder case carries its ticket device too.
  - The ACP connection is `in-process`.
- **`channelOf(sessionId)`** answers from the socket the gateway currently **routes** that session to.
  - The channel changes in the same step as the routing entry, before any vault evaluation for the new socket. Every routing write does this: `session_register`, and the move-commit hand-over (`pi-gateway.ts:730-745`). Each calls the hub's `handleRegister`.
  - An unrouted session yields `undefined` → deny.
  - A session that is **not connected** is not re-evaluated. Nothing can be sent to it; its view keeps today's `hub-unreachable` rows and the bridge's offline grace applies (`vault-delivery-hub.ts:64-69`).
- **The hub re-evaluates at register** as well as at sync and push. A new bridge sends `certValidation` in `session_register` as well as in `vault_sync_request`, so the register-time evaluation is complete and does not flap deny→ok. A socket swap (reconnect, plaintext fallback, a contention winner) therefore never sees the previous socket's channel.

### D4: Bearer exposure tracking (strict)

`PairedDevice` gains `exposure: { trackedSince: string; plaintextSeenAt?: string }`.

- **New rows** get `trackedSince`.
- **Rows created before this change** read as `history-unknown`, and their remote vault delivery is refused (strict, user decision). An older binary preserves the field on rewrite (row spread).
- **Proven channel** = proven TLS (D3), or a request whose local-credential verdict is `proof`. That means `credentialVerdict(headers).kind === "proof"`, NOT `hasLocalCredential`, which also accepts the legacy raw token (`packages/server/src/auth/local-credential.ts:95-98`).
  - Bare loopback is NOT proven. An L4 forwarder looks exactly like it (`bridge-upgrade-auth.ts:127-135`), and in-process code has no request.
  - The CLI `token create` mints through the operator route with the local token. It is not offered as a remedy: its tokens count as proven only if it sends a valid proof, which is not verified here.
- **Marking happens inside the registry.** `verify`/`verifyDetailed` take a **required** `channel` argument, so no call site can skip it:
  - `bearer-auth.ts:113,148`;
  - `server.ts:3365,3484,4973`;
  - the plugin host services at `server.ts:1728,1737`. These gain an optional request argument; absent means non-proven (fail closed). An MCP token used over plain HTTP is marked; one used without a request is marked conservatively.
  - the live-server proxy's `isDeviceBearer` closures (`live-server-proxy.ts:58,70,256,378`), which become `(token, req)`. The proxy strips **any** registry-known bearer before forwarding upstream, whatever the verdict (new `isKnownBearer`), so a refused `pi_tls_` bearer is never forwarded off-hub.

  Any row that resolves (`ok`, `superseded`, `expired`) on a non-proven channel gets `plaintextSeenAt`.
  - A `pi_tls_` bearer on a non-proven channel is also **refused** after marking. The response is 401 with the distinct error `tls_only_token_untrusted_channel`, so a client behind an HTTPS-terminating proxy (zrok, cloudflared, Tailscale Serve in front of `:8000`) gets a named cause instead of "unpaired or revoked".
  - The bridge maps that error to the cause `tls-only-token-relayed`.
- **Issue sites** pass the channel that **delivers** the token. An issue on a non-proven channel creates the row already exposed:
  - **Operator mint** (`pairing-routes.ts:665`): the response channel. The `pi_tls_` form is **opt-in**: only an issue with `purpose: "bridge"` (D9) on a proven channel gets it. MCP-client and other tokens stay plain, so the MCP flow and its `http://` snippets are unchanged.
  - **QR/knock:** `approve()` (`pairing.ts:606`) creates the row with `trackedSince` and no exposure decision. `poll()` (`:636-650`) marks it exposed when the poll request is non-proven, through a new `registry.markDelivered(id, channel)`. The token, holder handling and `expiresAt` response are unchanged. QR/knock tokens are never `pi_tls_`.
  - **Rotation** (`paired-devices.ts:314` via `pairing-routes.ts:243`): the new token keeps the old token's form. Rotation **never clears** exposure, which is per device row and permanent. A superseded bearer in its 60 s grace stays subject to the same marking. The remedy for an exposed device is a new bridge token (a new row), never rotation.
- **Writes.**
  - First exposure only (no hot-path write amplification).
  - The in-memory mark is set **before** the write and **stays** when the write fails (fail closed while running). It is retried on every later persist.
  - The exposure mark is persisted **on its own**, before any other mutation in the same request, for example a rotation. The existing rotation atomicity, which restores on failure (`paired-devices.ts:343-349`), covers only the rotation and never reverts the mark.
  - A failed exposure write is logged at error level and surfaced on `/api/health` as `pairing.exposureWritePending: true`. While any exposure write is pending, **all** remote vault delivery is refused (`bearer-exposed` for the marked device, `history-unknown` for the rest), because the hub cannot prove its record is durable.
  - Residual risk: a restart before any successful write loses the mark (see Risks).
  - Audit `auditLine("pairing","bearer-exposed",{id: prefix, channel})` once. It carries no bearer and no hash.
- **Eligibility** = active AND `trackedSince` AND no `plaintextSeenAt`.

**Alternative:** lenient, current-connection-only. Rejected (user decision).

### D5: Trust decision with a named cause

`decideVaultTrust({ origin, channel, device, bridgeCertCheck })` → `{ allow, outcome, detail? }`, checked in this order:

1. No channel (closed, unknown, unrouted) → `untrusted` / `unattributed`.
2. `channel.admission` ∈ {`unix`, `local-proof`, `in-process`} AND origin local → `allow`, device `hub`.
3. Origin local but admission is `local-ticket`, `legacy-token` or `grace` → `untrusted` / `local-unproven`. This is a behaviour tightening for deprecated hub-local paths (see Risks).
4. `admission === "device-ticket"` → the session is evaluated as `channel.ticketDeviceId`, even when the origin reads local. If the origin carries a different device id → `untrusted` / `unattributed`.
5. Device id absent / unattributed → `untrusted` / `unattributed`.
6. Device not active (revoked, held, expired, or unknown) → `untrusted` / `device-inactive`.
7. Not `channel.provenTls`, or (for a TLS-admitted channel) `tls.enabled && tls.acceptBridges` is not live-true → `transport-insecure` / `plain-transport`.
8. Device `exposed`, or an exposure write pending for it → `transport-insecure` / `bearer-exposed`.
9. Device `history-unknown`, or any exposure write pending → `transport-insecure` / `history-unknown`.
10. Not `channel.ticketTls` → `transport-insecure` / `ticket-plain` (defence in depth).
11. Bridge did not declare `certValidation: "enforced"` → `transport-insecure` / `bridge-outdated`.
12. Otherwise → `allow`.

**Deps.** `isTls` is replaced by:
- `getChannel(sessionId)` — **required**. Test harnesses pass a `unix` channel for hub sessions; this change rewords `add-vault-reach-all-projects` E2/2.1 to match;
- `getDeviceTrust(deviceId)` → `eligible` | `inactive` | `exposed` | `history-unknown`, from a single **active-device view**. That view merges the registry and, once `device-key-mutual-check` lands, its held-revoked store. Both stores feed the same change listener (D6), so either archive order works. If `device-key-mutual-check` archives first, task 5.11 wires its store here. If it archives second, that change wires its store into this view, and the wiring point is recorded in this design (not in an archived change). **Wiring point:** the `getDeviceTrust` dep of `createVaultDeliveryHub` and the `pairedDeviceRegistry.onChange(...)` subscription in `packages/server/src/server.ts` — a held row must read `inactive` there, and its hold/restore events must call the same `vaultDelivery.schedulePush()`, and `activeIds()` (the 30 s expiry sweep) must exclude it;
- the bridge's declared `certValidation`, stored from the sync request.

The outcome enum is unchanged (`packages/shared/src/vault-delivery.ts:31-37`). `detail` is new and optional (`VaultTrustDetail`, now including `local-unproven`).

**Dependent change.** `add-vault-reach-all-projects` test E2 / task 2.1 used "`isTls` false". This change rewords them to "paired device without a proven TLS channel". No code there depends on the dependency name.

### D6: Deactivation withdraws within 5 s

- The registry gains an `onChange(listener)` that fires on add, revoke, hold, restore, rotation and first exposure.
- The server wires it to `vaultDelivery.schedulePush()` (150 ms debounce). A config write that changes `tls.enabled` or `tls.acceptBridges` also pushes (D2).
- `compute()` re-reads device state per session, so every session of a deactivated or exposed device gets `denied`. The bridge withdraws on `denied` (`credential-delivery` "Rotation, revocation and reconciliation").
- Time-based expiry has no event. A 30 s sweep `setInterval` (unref'd) keeps the last-seen set of active device ids. It pushes only when a device left that set since the previous sweep (a transition), never on every tick.
- Bounds in the spec:
  - revoke, hold or exposure → denial ≤ 5 s (in practice ~150 ms);
  - expiry → denial ≤ 60 s.

### D7: The bridge enforces certificate validation for TLS endpoints

- **Scope.** Only connections that use TLS: a `wss:` dial and `https:` credential calls (ticket mint, `challengePinnedServer`, pi-trust live query). Plain `ws:`/`http:` remote endpoints are unchanged; they are never vault-eligible.
- **Per-call check order:**
  1. HTTP-URL validity — the existing `bad-http-url`.
  2. Token/origin scheme (D9) → `tls-only-token` (only the call that would carry the bearer is refused; with no ticket, no dial follows).
  3. Validation disabled in the process (`NODE_TLS_REJECT_UNAUTHORIZED=0` read at the call) → `tls-verify-disabled`.

  Each refusal sends no bearer and does not dial, and the cause is logged. Checking at each call covers a variable changed at runtime.
- **Belt and braces:** `wss` dials pass `rejectUnauthorized: true`.
- **Out of scope:** a global undici dispatcher installed by another extension in the same process (hostile in-process code).
- **Capability.** A bridge that applied these checks declares `certValidation: "enforced"` in `session_register` and `vault_sync_request` (D5 step 11).
- **Dial path.** A `wss:` endpoint with an empty or `/` path dials `/ws/bridge`. On the TLS listener only `/ws/bridge` is a bridge route. An explicit other path is kept for proxies in front of `:9999`; those are never vault-eligible.
- **Private CAs** keep working via `NODE_EXTRA_CA_CERTS`.

**Alternative:** warn only. Rejected (user decision).

### D8: Observability and remedies

- `getSessionState` adds `trustDetail` for `untrusted` / `transport-insecure`. The session vault chip shows the cause as text, icon and remedy:

  | Detail | Session-view remedy |
  |---|---|
  | `unattributed` | Connect as a paired device (`PI_DASHBOARD_TOKEN`, `operate` tier) |
  | `device-inactive` | Device revoked or expired — pair again |
  | `plain-transport` | Enable Built-in HTTPS + Accept bridges; set `PI_DASHBOARD_URL=wss://<name>:<tlsPort>` |
  | `bearer-exposed` | Token was used without TLS — issue a new token from the dashboard opened over HTTPS and connect only over `wss` |
  | `history-unknown` | Token predates TLS tracking — issue a new token as above |
  | `ticket-plain` | Use a `wss://` endpoint and an `https://` HTTP origin (`PI_DASHBOARD_HTTP_URL`) |
| `local-unproven` | Update pi-dashboard on this machine: the bridge must connect over the local socket or with a local proof |
  | `bridge-outdated` | Update pi-dashboard on the device |

- **Token-issue dialog** (Settings → device token): a "Bridge on another machine" purpose.
  - Over a non-proven channel, the dialog explains why the purpose is unavailable and links the native HTTPS URL (from `tlsListenerUrls()`). When there is none, it says "Turn on Built-in HTTPS to issue bridge tokens" and links the Built-in HTTPS section.
  - When issued, it shows the `PI_DASHBOARD_URL=wss://…` and `PI_DASHBOARD_TOKEN` snippet while Accept bridges is on and the bind is reachable.
- **Project picker:** the `transport-insecure` line drops "remote delivery is off" and says the session has no proven TLS connection.
- **Server log:** one line per session when its outcome or detail changes, never per sync. It carries no value and no bearer:

  ```text
  [vault] trust session=<id> device=<prefix> outcome=<o> detail=<d>
  ```

- **Bridge log:** named causes `tls-verify-disabled`, `tls-only-token` and `tls-only-token-relayed`. The bearer is never logged.

### D9: TLS-only tokens

- An operator token issued with `purpose: "bridge"` on a proven channel (D4) is minted with prefix `pi_tls_` + 32 random bytes base64url. The registry hashes the whole string, as for any token.
  - The token-issue dialog offers the purpose "Bridge on another machine (can receive vault values)". The MCP-client flow and the CLI send no `purpose` and keep plain tokens.
  - `purpose` is absent or `"bridge"`; any other value → 400. `bridge` forces tier `operate`, which bridge-ticket minting needs; an explicit lower tier → 400.
  - A `bridge`-purpose issue on a non-proven channel is refused: 403 `bridge_token_requires_https`, with the native HTTPS URL from `tlsListenerUrls()` when one exists. A bridge token is never handed out plain-and-exposed by accident.
- The bridge never sends a `pi_tls_` token to a non-`https:` origin, under any configuration (`tls-only-token`).
- **The bridge guarantee:** an active MITM on a plaintext path never sees the bridge's vault-eligible bearer, even when it drops the request so the hub observes nothing.
- **Other clients** (MCP, curl, scripts) that reuse a `pi_tls_` token are not covered by the bridge rule. The hub refuses and marks the token on any non-proven channel (D4), so such misuse is detected whenever the request arrives. A request that an active MITM drops on another client's plaintext path is unprotected — a stated residual risk.
- All other tokens keep the plain format: on a non-proven channel they are born exposed, and no bridge restriction applies to them.

## Risks / Trade-offs

- [The operator's browser issues a bridge token over plain-HTTP LAN, so it is born exposed and unrestricted] → The token-issue dialog states "not vault-eligible — open the dashboard over HTTPS to issue one". The session view names `bearer-exposed`.
- [Existing bridge devices all read `history-unknown`] → Accepted (strict). Remote delivery is off today, so nothing regresses. The FAQ documents re-issuing.
- [A `pi_tls_` token with a default plaintext topology (`ws://host:9999` → `http://host:8000`) cannot mint, so it does not connect (`tls-only-token`)] → Intended: only `pi_tls_` tokens are affected, and no pre-existing bridge holds one. The cause names the fix: a `wss://` endpoint, or an `https://` `PI_DASHBOARD_HTTP_URL`.
- [`NODE_TLS_REJECT_UNAUTHORIZED=0` users lose TLS remote bridges] → Named cause and an FAQ entry pointing to `NODE_EXTRA_CA_CERTS`. Plain `ws` bridges are unaffected.
- [Proxy-only users (zrok/cloudflared) cannot get remote vault values] → Non-goal, documented.
- [The `acceptBridges` surface] → Opt-in, ticket-only, no loopback grace or local credential. Same host-admission and Origin gates.
- [Registry write failure, then a restart before any successful write] → The exposure mark is lost. While the process runs, any pending exposure write refuses all remote delivery, and `/api/health` reports it. The lost-on-restart residual is accepted.
- [Hub-local tightening (D5 step 3)] → Bridges admitted by the legacy raw token, the tokenless grace or a bearer-less ticket lose hub vault delivery (`local-unproven`). These paths are deprecated: the grace ends at 1.0.0, and current bridges use the unix socket or a local proof. Closing them shuts an L4-forwarder hole in shipped delivery.
- [A `pi_tls_` token reused by a plain-HTTP client] → It is refused (401) and marked, so the client fails loudly. A dropped request is the stated residual (D9).
- [Coupling with `device-key-mutual-check`] → Trust reads the registry's active view, and a held row is inactive. Whichever change archives second rebases the `onChange` events on the other's state names.
- [Rolling back to an older binary] → Exposure fields are preserved (row spread), so a re-upgrade keeps them. An older binary would deliver nothing remote anyway, because it has no `isTls` wiring.

- [Default-config side effects] → These run even with TLS off, and are accepted:
  - first plain-HTTP use of a bearer writes the registry once and emits one audit line;
  - `/api/health` gains a pending-exposure field;
  - registry changes trigger a debounced vault push;
  - hub-local delivery is tightened (`local-unproven`).

  None changes delivery for proof- or socket-admitted hub sessions.

## Migration Plan

1. Ship server and bridge together. `tls.acceptBridges` defaults to `false`, so behaviour is unchanged until it is turned on.
2. Turn on Built-in HTTPS (bound to a tailnet/LAN host) and Accept bridges.
3. Open the dashboard over HTTPS and issue a token with purpose "Bridge on another machine" (prefixed `pi_tls_`). On the device, set `PI_DASHBOARD_TOKEN` and `PI_DASHBOARD_URL=wss://<name>:8443`.
4. Rollback: turn Accept bridges off. The server closes TLS-admitted bridge sockets and pushes; trust denies TLS channels while the switch is off, so values are withdrawn within 5 s. `pi_tls_` tokens still work against the HTTPS origin for non-vault use.
