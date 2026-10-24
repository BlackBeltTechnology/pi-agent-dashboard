# Test Plan — prove-vault-bridge-tls

Stage: design   Generated: 2026-10-24

The hard gate passed. One clarification was answered and folded into `specs/bearer-device-auth/spec.md`:
- **C1.** On a plain-HTTP dashboard with no native HTTPS address, the token dialog shows the bridge purpose disabled, with "Turn on Built-in HTTPS to issue bridge tokens" and a link to the Built-in HTTPS section.

Inherited and not re-tested here: redaction (`credential-delivery`), the bridge's withdrawal on `denied` (`credential-delivery` "Rotation, revocation and reconciliation"), and ticket single-use for the `:9999` path (`pi-gateway-auth`).

Real TLS in L1 uses the committed test CA and leaves in `packages/server/src/tls/__tests__/fixtures/` and the `handshake()` helper in `packages/server/src/tls/__tests__/helpers.ts`. A bridge-side CA trust test that needs `NODE_EXTRA_CA_CERTS` runs in a spawned node child, because the variable is read at process start.

Exemplars:
- **L1 server:**
  - `packages/server/src/__tests__/vault-delivery-trust.test.ts` (trust gate);
  - `vault-delivery-wiring.test.ts` (hub ↔ gateway messages);
  - `paired-devices.test.ts`;
  - `bearer-auth.test.ts`;
  - `ws-ticket.test.ts`;
  - `pairing.test.ts`;
  - `bridge-upgrade-auth.test.ts`;
  - `gateway-listener-wiring.test.ts`;
  - `pi-gateway-duplicate-register.test.ts`;
  - `live-server-proxy.test.ts`;
  - `tls-config-api.test.ts`;
  - `packages/server/src/tls/__tests__/tls-listener.test.ts` (real TLS).
- **L1 bridge:**
  - `packages/extension/src/__tests__/bridge-ticket-client.test.ts`;
  - `remote-registration-gate.test.ts`;
  - `connect-target.test.ts`;
  - `connection.test.ts`;
  - `vault-delivery.test.ts`.
- **L1 shared:** `packages/shared/src/__tests__/server-pinning.test.ts`.
- **L1 client:**
  - `packages/client/src/components/session/__tests__/VaultBindingsChip.test.tsx`;
  - `packages/client/src/components/settings/vault/__tests__/VaultProjectPicker.test.tsx`;
  - `packages/client/src/components/Gateway/__tests__/GatewayTlsSection.test.tsx`;
  - `packages/client/src/components/connectivity/__tests__/PairedDevicesSection.test.tsx`.
- **L3:**
  - `tests/e2e/gateway-url-action.spec.ts` (Gateway page);
  - `tests/e2e/mcp-token-settings.spec.ts` (token dialog).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | credential-delivery: Delivery only to granted sessions on trusted devices (hub-local admission) | decision-table | L1 | automated | hub session (origin local) granted `SONIOX_API_KEY`, admission: (a) `unix`; (b) `local-proof`; (c) `in-process`; (d) `legacy-token`; (e) `grace`; (f) `local-ticket` | `handleRegister` then `handleSyncRequest` per row | (a–c) snapshot `ok`, carries `SONIOX_API_KEY`; (d–f) `denied`, outcome `untrusted`, `trustDetail: local-unproven`, no entries |
| E2 | credential-delivery: The hub proves a remote session's TLS itself (decision table) | decision-table | L1 | automated | device `dev-a`, project granted `SONIOX_API_KEY`. Rows: (a) device-ticket, provenTls, ticketTls, eligible, `certValidation: enforced`, `acceptBridges` true; (b) = (a) with `acceptBridges` false; (c) device-ticket on loopback (`ssh -L`), not provenTls; (d) ticketTls false; (e) device `exposed`; (f) `history-unknown`; (g) `inactive`; (h) no `certValidation`; (i) ticket device `dev-a`, origin device `dev-b`; (j) no channel | `handleSyncRequest` per row | (a) `ok` with `SONIOX_API_KEY`; (b,c) `transport-insecure`/`plain-transport`; (d) `transport-insecure`/`ticket-plain`; (e) `bearer-exposed`; (f) `history-unknown`; (g) `untrusted`/`device-inactive`; (h) `transport-insecure`/`bridge-outdated`; (i,j) `untrusted`/`unattributed`; every refusal row has no entries |
| E3 | credential-delivery: The hub proves a remote session's TLS itself (proven-TLS predicate) | EP | L1 | automated | requests: encrypted socket with no forwarding header; encrypted + each of `X-Forwarded-For`, `Forwarded`, `X-Forwarded-Proto`, `Via`, `X-Forwarded-Port`, `X-Forwarded-Server`; plain socket with none | `isProvenTls(req)` | true only for encrypted with no header; false for the 7 other inputs |
| E4 | bearer-device-auth: Plaintext bearer exposure is recorded (channel table) | decision-table | L1 | automated | an unexposed tracked device bearer presented on `POST /api/ws-ticket` via: (a) TLS listener, no header; (b) TLS listener + `X-Forwarded-For`; (c) main listener from `192.168.1.20`; (d) main from `127.0.0.1`, no proof; (e) main from `127.0.0.1` with the legacy raw `X-Pi-Local-Token`; (f) main from `127.0.0.1` with a valid local proof | request per row (fresh device each) | `plaintextSeenAt` set for (b,c,d,e), absent for (a,f); one `bearer-exposed` audit line per marked row naming the id prefix + channel; no audit line contains the bearer or its SHA-256 |
| E5 | bearer-device-auth: Bridge tokens issued on a proven channel are TLS-only + Direct token issuance for a local operator (issue table) | decision-table | L1 | automated | operator mint `POST /api/paired-devices` with `purpose` absent / `bridge`, × channel: TLS listener / plain LAN `192.168.1.10` (no local proof); plus on TLS: `purpose: "other"` and `purpose: "bridge"` + `tier: "observe"` | request per combination | bridge+TLS → token `^pi_tls_`, tier `operate`, unexposed; bridge+plain → 403 `bridge_token_requires_https`, no row created, body carries the HTTPS address; absent+TLS → token without `pi_tls_`, unexposed; absent+plain → token without `pi_tls_`, device exposed; `other` and bridge+observe → 400, no row |
| E6 | bearer-device-auth: Plaintext bearer exposure is recorded (QR collection) | state-transition | L1 | automated | QR pairing: (a) approve over TLS, poll from plain LAN; (b) approve over plain, poll over TLS; (c) as (b) with poll `holder: "browser"` | `approve()` then `poll()` | (a) device exposed; (b) device unexposed; token identical to the one created at approve, never `pi_tls_`; (c) poll response still carries `expiresAt` |
| E7 | bearer-device-auth: Bridge tokens issued on a proven channel are TLS-only (rotation) | state-transition | L1 | automated | (a) exposed plain device; (b) unexposed `pi_tls_` device; (c) unexposed plain MCP device with `writeJsonFile` made to throw on the rotation write | rotate over TLS for (a,b); rotate over plain LAN for (c) | (a) new token plain, still exposed; (b) new token `^pi_tls_`; (c) the exposure mark is persisted in its own write before rotation, and the rotation is rolled back while `plaintextSeenAt` stays |
| E8 | bearer-device-auth: Bridge tokens issued on a proven channel are TLS-only + Bearer auth branch for REST (refusal) | EP | L1 | automated | unexposed `pi_tls_` bearer | presented on: main listener from LAN; main listener from `127.0.0.1` with `X-Forwarded-For`; TLS listener, no header | first two → 401 `{error: "tls_only_token_untrusted_channel"}` and the device is exposed; third → authenticated |
| E9 | bearer-device-auth: Plaintext bearer exposure is recorded (non-REST call sites) | EP | L1 | automated | unexposed device bearer | (a) checked on a plaintext live-server WS upgrade; (b) checked via plugin host `verifyDeviceToken(token)` with no request; (c) `pi_tls_` bearer in `Authorization` on a plaintext live-server proxy request | (a,b) device exposed; (c) upstream request has no `Authorization` header, and the device is exposed |
| E10 | bearer-device-auth: Plaintext bearer exposure is recorded (written once) | BVA | L1 | automated | an exposed device, registry write spy | 1, 2 and 50 further plain-HTTP presentations | registry file writes for exposure stay at exactly 1; `plaintextSeenAt` unchanged |
| E11 | bearer-device-auth: Plaintext bearer exposure is recorded (legacy rows) | EP | L1 | automated | `paired-devices.json` row without `exposure` (pre-change); and a row with `exposure` | load; `deviceTrust(id)`; persist via an unrelated `touch` | legacy row → `history-unknown`; tracked row keeps `exposure.trackedSince` + `plaintextSeenAt` byte-equal after the rewrite |
| E12 | pi-gateway-auth: A remote bridge enforces certificate validation on TLS connections + A TLS-only token never leaves the bridge in plaintext | decision-table | L1 | automated | `fetchImpl` spy. Rows: (a) invalid `PI_DASHBOARD_HTTP_URL` + `NODE_TLS_REJECT_UNAUTHORIZED=0`; (b) `pi_tls_` token + `ws://dash.example:9999`; (c) `pi_tls_` + `wss://dash.example:8443` + `PI_DASHBOARD_HTTP_URL=http://dash.example:8000`; (d) `pi_tls_` + `ws://dash.example:9999` + `PI_DASHBOARD_HTTP_URL=https://dash.example:8443`; (e) `wss://dash.example:8443` + env `0`; (f) plain token + `ws://dash.example:9999` + env `0`; (g) local socket + env `0` | `prepareConnect` | (a) cause `bad-http-url`, 0 fetches; (b,c) cause `tls-only-token`, 0 fetches; (d) one fetch to `https://dash.example:8443/api/ws-ticket`, dial `ws://dash.example:9999`; (e) cause `tls-verify-disabled` naming the variable, 0 fetches; (f,g) proceed as today |
| E13 | pi-gateway-auth: A path-less TLS bridge endpoint dials the bridge path | EP | L1 | automated | endpoints `wss://dash.example.ts.net:8443`, `wss://dash.example.ts.net:8443/`, `wss://proxy.example/pi`, `ws://dash.example:9999` | resolve the dial URL | `…:8443/ws/bridge`, `…:8443/ws/bridge`, `wss://proxy.example/pi`, `ws://dash.example:9999` (each with `?ticket=`) |
| E14 | pi-gateway-auth: A remote bridge enforces certificate validation on TLS connections (declaration) | EP | L1 | automated | bridge connected (a) over `wss` with the checks applied; (b) over plain `ws`; (c) over the local socket | capture `session_register` + `vault_sync_request` | (a) both carry `certValidation: "enforced"`; (b, c) neither carries it |
| E15 | dashboard-tls-listener: Bridge admission over the TLS listener + pi-gateway-auth: A ticket-admitted TLS bridge is attributed to its device | decision-table | L1 | automated | real TLS listener (fixture CA) + gateway TCP listener started. Rows: (a) `acceptBridges` true, device ticket from `127.0.0.1`; (b) the same ticket presented again; (c) `acceptBridges` false; (d) main plaintext listener, `acceptBridges` true; (e) TLS, true, deviceless local ticket; (f) TLS, true, no ticket, loopback peer; (g) TLS, true, gateway not started | WS upgrade to `/ws/bridge` | (a) 101, session registers, `originDeviceId` = ticket device (remote); (b) refused; (c) 400, log `tls-bridges-off`, ticket still consumable; (d) 400, ticket still consumable; (e) refused, log `tls-deviceless-ticket`; (f) refused; (g) 503, log `tls-gateway-not-ready` |
| E16 | credential-delivery: The hub proves a remote session's TLS itself (ticket flags) | EP | L1 | automated | `POST /api/ws-ticket {scope: bridge}` via (a) TLS listener + device bearer; (b) TLS + `X-Forwarded-For`; (c) main listener + device bearer; (d) main from `127.0.0.1` with local proof, no bearer | mint, then `consumeDetailed` | (a) `provenTls: true`, `mintedBy: device`; (b,c) `provenTls: false`; (d) `mintedBy: local`, no `deviceId` |
| E17 | dashboard-tls-listener: Bridge admission over the TLS listener (config) | EP | L1 | automated | stored `tls {port: 9443, sources: [1]}` | `PUT /api/config {tls: {acceptBridges: "yes"}}`; then `{tls: {acceptBridges: true}}` | first → 400, config unchanged; second → 200, stored `port: 9443`, 1 source, `acceptBridges: true` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | credential-delivery: Deactivating a device withdraws its delivered values (revoke/exposure bound) | threshold (fake timers) | L1 | automated | 2 trusted sessions on device `dev-a`, 1 on `dev-b`; then (a) `DELETE /api/paired-devices/dev-a`; (b) a first plain-HTTP presentation of `dev-a`'s bearer | time from event to `denied` sent on both `dev-a` sessions ≤ 5 000 ms (expect ~150 ms); `dev-b` session gets no `denied` | 10 s simulated |
| P2 | credential-delivery: Deactivating a device withdraws its delivered values (expiry bound) | threshold + soak (fake timers) | L1 | automated | trusted session; device `expiresAt` = t0+10 s; 30 s sweep | `denied` sent by t0+60 s; 0 pushes from sweeps while the active set is unchanged across 10 idle sweeps | 6 min simulated |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | credential-delivery: The hub proves a remote session's TLS itself (downgrade on reconnect) | state-transition | L1 | automated | trusted TLS session holding `SONIOX_API_KEY` | its socket closes; the same session id re-registers over plain `ws` (device ticket); then over TLS again | 1st re-register: the first vault message on the new socket is `denied`/`plain-transport`, sent before any `ok`; 2nd: `ok` with `SONIOX_API_KEY` |
| F2 | credential-delivery: The hub proves a remote session's TLS itself (move-commit) | state-transition | L1 | automated | trusted TLS session | gateway move-commit hands the routing entry to a plain socket | `channelOf` returns the plain channel; the hub sends `denied` without a sync request |
| F3 | credential-delivery: The hub proves a remote session's TLS itself (disconnected session) | state-transition | L1 | automated | trusted session holding `SONIOX_API_KEY` | socket closes; a vault write triggers a push | no send attempted for it; `getSessionState` outcome still `delivered`, rows `hub-unreachable` |
| F4 | credential-delivery: A refused remote session names the missing proof (session view) | EP | L1 | automated | session state with `trustDetail` ∈ {`unattributed`, `local-unproven`, `device-inactive`, `plain-transport`, `bearer-exposed`, `history-unknown`, `ticket-plain`, `bridge-outdated`} (8 rows) | render `VaultBindingsChip` + open | each shows an icon + cause text + remedy; `plain-transport` text contains "Accept bridges" and "wss://"; `bearer-exposed`/`history-unknown` say to issue a new token over HTTPS; text ≥ 12 px |
| F5 | credential-delivery: A refused remote session names the missing proof (picker) | EP | L1 | automated | open project with `blocked: "transport-insecure"` | render `VaultProjectPicker` | line says "no proven TLS connection"; does not contain "remote delivery is off" |
| F6 | dashboard-tls-listener: Accept bridges switch in the Built-in HTTPS section | state-transition | L1 | automated | TLS enabled, stored `port: 9443`, one source; status (a) bind reachable, name `dash.example.ts.net`; (b) bind `127.0.0.1`; (c) config PUT fails 500 | toggle Accept bridges on | (a) PUT body is exactly `{tls: {acceptBridges: true}}`; `wss://dash.example.ts.net:9443` is shown with a copy button; (b) no `wss://` text, `bind-reachable` fix shown; (c) switch back off, inline error shown |
| F7 | bearer-device-auth: Bridge tokens issued on a proven channel are TLS-only (dialog) | decision-table | L1 | automated | dialog opened (a) on a proven channel with Accept bridges on + reachable bind; (b) on plain HTTP, `tlsListenerUrls = [https://dash.example.ts.net:8443]`; (c) on plain HTTP, no TLS URL | choose the purpose "Bridge on another machine" (+ issue in a) | (a) token `^pi_tls_` plus a snippet with `PI_DASHBOARD_URL=wss://…` and `PI_DASHBOARD_TOKEN`; (b) purpose disabled, shows `https://dash.example.ts.net:8443`; (c) purpose disabled, "Turn on Built-in HTTPS to issue bridge tokens" link targeting the Built-in HTTPS section; MCP purpose flow unchanged in all |
| F8 | dashboard-tls-listener: Accept bridges switch in the Built-in HTTPS section (rendered) | state-transition | L3 | automated | docker harness dashboard, Gateway page, Built-in HTTPS enabled with loopback bind (no certs) | toggle Accept bridges on; reload the page | switch on after reload; `GET /api/config` → `tls.acceptBridges: true`; no `wss://` endpoint text; `bind-reachable` fix visible |
| F9 | bearer-device-auth: Bridge tokens issued on a proven channel are TLS-only (rendered dialog) | EP | L3 | automated | docker harness over plain HTTP, Built-in HTTPS off | open the device-token dialog; create an MCP token | bridge purpose disabled with the "Turn on Built-in HTTPS" link; MCP token created as before (no `pi_tls_` prefix) |
| F10 | credential-delivery: A refused remote session names the missing proof (log) | state-transition | L1 | automated | refused session `plain-transport` | 3 syncs unchanged; then detail changes to `bearer-exposed`; then 2 more syncs | exactly 2 `[vault] trust` lines; each has session id, device prefix, outcome, detail; no line contains the bearer, its hash, or a value |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | bearer-device-auth: Plaintext bearer exposure is recorded (persist failure) | fault-injection (abort) | L1 | automated | `writeJsonFile` throws on the first exposure write; a second trusted TLS device is connected | plain-HTTP presentation of device A's bearer; then the fault clears and any persist runs | while failing: A reads exposed, `/api/health` `pairing.exposureWritePending: true`, every remote session (A → `bearer-exposed`, B → `history-unknown`) gets `denied`; after success: pending false, file has A's `plaintextSeenAt`, B is delivered again |
| X2 | dashboard-tls-listener: Bridge admission over the TLS listener (switch off) | fault-injection (abort) | L1 | automated | trusted TLS bridge connected (real TLS) | `PUT /api/config {tls: {acceptBridges: false}}` | the bridge socket is closed within 5 s; `denied` pushed; a reconnect upgrade gets 400 `tls-bridges-off` |
| X3 | credential-delivery: Deactivating a device withdraws its delivered values (listener stop) | fault-injection (abort) | L1 | automated | trusted TLS bridge connected | the TLS listener stops (`tls.enabled: false` reconcile) | TLS-admitted gateway socket closed; the session is not delivered on any later evaluation |
| X4 | pi-gateway-auth: A remote bridge enforces certificate validation on TLS connections (trust store) | fault-injection (abort) | L1 | automated | local HTTPS+WSS server with a leaf from the fixture CA; spawned node child bridge | dial (a) without `NODE_EXTRA_CA_CERTS`; (b) with `NODE_EXTRA_CA_CERTS=<fixture ca.pem>` | (a) TLS error, no register, no bearer reaches the server; (b) ticket minted, registered |
| X5 | pi-gateway-auth: A remote bridge enforces certificate validation on TLS connections (runtime flip) | fault-injection | L1 | automated | `wss` bridge connected | set `NODE_TLS_REJECT_UNAUTHORIZED=0`, force a reconnect | `tls-verify-disabled` logged; 0 ticket fetches; no dial |
| X6 | pi-gateway-auth: A TLS-only token never leaves the bridge in plaintext (relayed) | fault-injection (abort) | L1 | automated | mint answers 401 `{error: "tls_only_token_untrusted_channel"}` | `prepareConnect` with a `pi_tls_` token | cause `tls-only-token-relayed`; the log does not say "unpaired" or "revoked" |
| X7 | credential-delivery: Deactivating a device withdraws its delivered values (bridge side) | fault-injection | L1 | automated | bridge holding delivered `SONIOX_API_KEY` | hub sends `denied`/`untrusted` with `trustDetail: device-inactive` | the next child command env has no `SONIOX_API_KEY`; the bridge reports it withdrawn |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | credential-delivery: The hub proves a remote session's TLS itself (real tailnet) | exploratory | — | manual-only | hub with a Tailscale cert, Built-in HTTPS bound to the tailnet IP, Accept bridges on; second physical machine with a `pi_tls_` token and `PI_DASHBOARD_URL=wss://<host>.ts.net:8443` | start pi in a project granted `SONIOX_API_KEY`; then turn Accept bridges off | [judgment: real cert, real second host, real network] the chip shows `delivered`; `printenv SONIOX_API_KEY` is redacted in output; after the switch-off, the chip shows `plain-transport` and the key is gone from the next command within 5 s |

---

## Coverage summary

- Requirements covered: 15/15:
  - credential-delivery: the MODIFIED requirement plus 3 ADDED;
  - pi-gateway-auth: 4 ADDED;
  - bearer-device-auth: 2 MODIFIED plus 2 ADDED;
  - dashboard-tls-listener: 1 MODIFIED plus 2 ADDED.
- Scenarios by class: edge 17 · perf 2 · frontend 10 · error 7 · manual 1.
- Scenarios by level: L1 34 · L3 2 · manual 1.
- Scenarios by disposition: automated 36 · manual-only 1.

## New infra needed

- None. Real TLS reuses the `tls/__tests__` fixtures and `handshake()` helper. X4 spawns a node child; `connection.test.ts` or `remote-registration-gate.test.ts` already exercise the bridge in-process, and `child_process.fork` from vitest is enough.
