# browser-operator-host Specification

## Purpose
TBD - created by archiving change add-operator-browser-relay. Update Purpose after archive.

## Requirements

### Requirement: Operator host identity and registration

`GET /api/browser/status` SHALL include `operatorHosts: true` when the server supports operator browser hosts, and a client SHALL send no `browser_host_*` message to a server whose status lacks it. A host SHALL register in three steps on one `/ws` socket: `browser_host_hello {hostId, publicKey}`; the server's `browser_host_challenge {nonce, serverId}` with 32 random bytes and the server's own `/api/health` `instanceId`; `browser_host_register {hostId, signature, label, platform, canOpenChrome, profiles}`, where `signature` is an Ed25519 signature by the host's private key over `"pi-browser-host-v1\n" + nonce + "\n" + serverId`, verified by the server against its own `instanceId` and `hostId` is `host-` followed by the first 32 hex characters of SHA-256 of the public key. The server SHALL pin the first verified public key per `hostId` in its plugin data directory and SHALL refuse a register whose key differs from the pin, whose signature does not verify, or whose `hostId` does not derive from its key. A verified register SHALL be answered `browser_host_registered {hostId}`. A socket SHALL hold at most one host. A verified register for a `hostId` bound to another live socket SHALL be refused with reason `host-active` while that socket has a live link or pending connect, and SHALL otherwise re-bind the host; a register SHALL never close a live instance. `label` SHALL be ≤ 128 characters, `profiles` ≤ 64 rows of `{profileDirectory, label, email?, installed}` with `profileDirectory` ≤ 128 characters and no path separator and `email` ≤ 254 characters; violations SHALL be refused. `GET /api/browser/profiles` SHALL list bound hosts under `operatorHosts: [{hostId, label, platform, online, canOpenChrome, profiles}]`, each profile row carrying the registered fields plus server-known `instances`. `DELETE /api/browser/operator-hosts/<hostId>` SHALL remove the pin, under the same REST authentication as the other `/api/browser/*` routes and REST tier `operate`. Pins not seen for 90 days SHALL be pruned, and at most 256 pins SHALL be kept, dropping the least recently seen.

#### Scenario: Capable Electron registers
- **WHEN** an Electron main window on its local origin is switched to a server that reports `operatorHosts: true`
- **THEN** it SHALL complete hello → challenge → register, receive `browser_host_registered`, and `GET /api/browser/profiles` SHALL list its `hostId` with `online: true`

#### Scenario: Older server
- **WHEN** the server's `GET /api/browser/status` lacks `operatorHosts: true`
- **THEN** the client SHALL send no `browser_host_*` message

#### Scenario: Impersonation attempt
- **WHEN** another authenticated client sends `browser_host_register` for a pinned `hostId` with a signature made by a different key
- **THEN** the register SHALL be refused, the real host's binding and instances SHALL be unaffected, and an audit entry under `host:<hostId>` and a log line with `pin=mismatch` SHALL be recorded

#### Scenario: Same machine on a second socket while active
- **WHEN** host H is bound to socket A with a live instance and a correctly signed register for H arrives on socket B
- **THEN** the register on B SHALL be refused with reason `host-active` and the instance on A SHALL stay live

#### Scenario: Re-bind after reload
- **WHEN** host H's socket A has closed and a correctly signed register for H arrives on socket B
- **THEN** H SHALL be bound to B

#### Scenario: Signature for another server
- **WHEN** a register's signature was made over a different `serverId`
- **THEN** the register SHALL be refused

#### Scenario: Oversized registration
- **WHEN** a register carries 65 profiles or a 129-character `label`
- **THEN** it SHALL be refused and no host SHALL be listed

### Requirement: Host-targeted connect

`POST /api/browser/connect` SHALL accept an optional `host`; omitted or `"dashboard"` SHALL behave exactly as the dashboard-host connect. For a `hostId` the server SHALL mint the guid and a separate random 128-bit `linkId`, keep `linkId → guid` server-side only, and send `browser_host_connect {requestId, linkId, instanceId, profileDirectory, serverLabel}` to that host's bound socket only. The server SHALL accept `browser_host_connect_result {requestId, ok, reason?}` for that request only from that socket. It SHALL wait up to 60 s for the result, and the existing 60 s handshake window SHALL start when `ok: true` arrives. The response SHALL be: 403 while the relay is disabled; 404 `{reason: "unknown-host"}` when no live socket holds the host; 409 `{reason: "not-installed"}` when the profile is absent from the host's rows or `installed: false`; 409 `{reason: "busy", instanceId?}` when a live instance or a pending connect exists for the same (host, profileDirectory); 409 `{reason: "host-busy"}` when the host has 8 links or 2 pending connects; 403 `{reason: "operator-denied"}` for `ok: false, reason: "denied"`; 503 `{reason: "no-chrome"}` for `reason: "no-chrome"`; 503 `{reason: "launch-failed"}` for any other `ok: false`; 504 `{reason: "consent-timeout"}` when no result arrives within 60 s; 503 `{reason: "host-gone"}` when the socket closes before the handshake; 504 when no handshake completes within 60 s of `ok: true`; otherwise 200 `{cdpUrl, instanceId}` with the dashboard host's loopback `cdpUrl` form. Whenever the server abandons a connect after sending `browser_host_connect`, it SHALL send `browser_host_connect_cancel {requestId}` to that socket. Operator instances SHALL apply the relay deny-list and SHALL NOT apply the dashboard host's per-profile configuration (`token`, `zeroDialog`, `allowedDomains`). The guid SHALL never be sent to any client.

#### Scenario: Operator connect succeeds
- **WHEN** an agent calls `connect` with `host: H` for a profile H lists as installed, the operator allows, and the extension attaches through the link
- **THEN** the response SHALL be 200 with a `cdpUrl` on `127.0.0.1` of the dashboard host, and no message sent to any client SHALL contain the guid

#### Scenario: Unknown host
- **WHEN** `connect` names a `host` that no live socket holds
- **THEN** the response SHALL be 404 `{reason: "unknown-host"}` and no guid SHALL be minted

#### Scenario: Operator denies
- **WHEN** the host answers `ok: false, reason: "denied"`
- **THEN** the response SHALL be 403 `{reason: "operator-denied"}` and the guid and `linkId` SHALL be discarded

#### Scenario: Late Allow still gets a full handshake window
- **WHEN** the host answers `ok: true` 50 s after `browser_host_connect` and the extension handshake completes 20 s later
- **THEN** the response SHALL be 200

#### Scenario: No consent answer
- **WHEN** the host sends no `connect_result` within 60 s
- **THEN** the response SHALL be 504 `{reason: "consent-timeout"}` and the host SHALL receive `browser_host_connect_cancel` for that `requestId`

#### Scenario: Same profile name on two hosts
- **WHEN** the dashboard host's `Default` profile has a live instance and `connect` names `host: H, profileDirectory: "Default"`
- **THEN** the connect SHALL NOT return `busy`

#### Scenario: Pending connect is deduplicated
- **WHEN** a connect for (H, `Default`) is waiting for consent and a second one for (H, `Default`) arrives
- **THEN** the second SHALL return 409 `{reason: "busy"}` and no second `browser_host_connect` SHALL be sent

#### Scenario: Host goes away mid-connect
- **WHEN** the host socket closes after `browser_host_connect` and before the handshake
- **THEN** the response SHALL be 503 `{reason: "host-gone"}`

### Requirement: Operator link stream

A link SHALL be carried only by the socket the connect was sent to. `browser_host_ext_open {linkId}` SHALL be accepted only after that link's `connect_result {ok: true}` and only once, and SHALL attach a link socket to the guid as its extension socket. `browser_host_ext_data {linkId, data}` SHALL deliver `data` to the relay as one extension frame, and `browser_host_ext_close {linkId, code}` SHALL close the link. Relay frames to the extension SHALL be sent to that socket only as `browser_host_relay_data {linkId, data}`, and a relay-side close as `browser_host_relay_close {linkId, code, reason}`. The link socket's backpressure signal SHALL be the carrier socket's buffered amount. A `browser_host_*` message naming a `linkId` or `requestId` not owned by the sending socket, an `ext_open` before `ok: true` or for a claimed link, or a non-string `data` SHALL be dropped and audited `denied` under `host:<hostId>` with detail `browser_host:<type>`. A `data` longer than 16 MiB SHALL close the link with code 1009. When the carrier socket's buffered amount stays above 32 MiB for 10 s, every link on it SHALL close with code 1013 and reason `carrier-congested`. The deny-list, screencast tap and audit SHALL apply to a linked instance exactly as to a dashboard-host instance.

#### Scenario: Link carries the handshake
- **WHEN** the host sends `ext_open` after `ok: true` and then the extension's `extension.initialized` frame as `ext_data`
- **THEN** the connect SHALL resolve 200 and the agent's CDP traffic SHALL reach the operator's Chrome through `browser_host_relay_data`

#### Scenario: Attach before consent
- **WHEN** the host sends `ext_open` for a `linkId` whose `connect_result` has not arrived
- **THEN** the `ext_open` SHALL be dropped and audited, and the connect SHALL remain waiting for consent

#### Scenario: Foreign socket names a link
- **WHEN** a different authenticated socket sends `browser_host_ext_data` or `browser_host_connect_result` naming a live link or request
- **THEN** the message SHALL be dropped, the link SHALL be unaffected, and a `denied` audit entry SHALL be recorded

#### Scenario: Oversized frame
- **WHEN** the host sends a `data` of 16 MiB + 1 byte
- **THEN** the link SHALL close with code 1009 and its instance SHALL close

#### Scenario: Congested carrier
- **WHEN** the carrier socket's buffered amount stays above 32 MiB for 10 s
- **THEN** every link on it SHALL close with code 1013 `carrier-congested` and their instances SHALL close

#### Scenario: Deny-list on a linked instance
- **WHEN** the agent sends `Network.getAllCookies` on a linked instance
- **THEN** the relay SHALL answer `-32000` as for a dashboard-host instance, and nothing SHALL be sent to the host for it

#### Scenario: Carrier messages are unicast
- **WHEN** two clients are connected and one is host H's carrier with a live link
- **THEN** only H's carrier SHALL receive `browser_host_relay_data`, `browser_host_connect`, `browser_host_connect_cancel` and `browser_host_tee` for that link

### Requirement: Local frame viewers

`browser_relay_subscribe` SHALL accept an optional `local: true`. When the subscribing socket is the carrier bound to the instance's host, the relay SHALL count the socket as a viewer for starting, keeping and stopping the tab's screencast, SHALL NOT send it `browser_relay_frame`, and SHALL send it `browser_host_tee {linkId, instanceId, tabId, on: true}`, then `on: false` when that viewer's subscription ends. From any other socket `local` SHALL be ignored, the subscribe SHALL be handled normally, and the downgrade SHALL be audited as kind `denied` with detail `browser_host:local-ignored`. A socket SHALL hold at most one subscription per tab, whose mode is that of its most recent subscribe; `browser_host_tee {on: true}` SHALL be sent when the mode becomes local and `on: false` when it stops being local or the subscription ends, and the socket SHALL never receive `browser_relay_frame` for that tab while its mode is local. Frame acknowledgement SHALL be unchanged.

#### Scenario: Pane on the operator machine
- **WHEN** the operator window's pane subscribes with `local: true` to a tab of an instance hosted through its own socket
- **THEN** the socket SHALL receive `browser_host_tee {on: true}` and no `browser_relay_frame`, and the tab's screencast SHALL be running

#### Scenario: Local flag from another client
- **WHEN** a phone subscribes with `local: true` to the same tab
- **THEN** it SHALL receive `browser_relay_frame` messages as a normal viewer and a `denied` audit entry with detail `browser_host:local-ignored` SHALL be recorded

#### Scenario: Mode switch on the carrier
- **WHEN** the carrier subscribes a tab with `local: true` and then subscribes the same tab without `local`
- **THEN** it SHALL receive `browser_host_tee {on: false}` before its first `browser_relay_frame` for that tab

### Requirement: Operator host lifecycle

When a host's socket closes, the host SHALL be shown `online: false` (or omitted) in `operatorHosts`, every instance hosted through it SHALL close with reason `host-gone`, and its pending connects SHALL return 503 `{reason: "host-gone"}`. The kill switch SHALL close linked instances like any other and SHALL make every host-targeted connect return 403 while disabled. Bindings SHALL be in memory; only the public-key pins SHALL persist.

#### Scenario: Operator closes the window
- **WHEN** an operator-hosted instance is live and the operator's dashboard window closes
- **THEN** the instance SHALL close, its CDP client socket SHALL close, and the host SHALL no longer be listed online

#### Scenario: Server restart
- **WHEN** the dashboard server restarts
- **THEN** no host SHALL be online until it registers again, and a register with the pinned key SHALL succeed

### Requirement: Operator host observability

The server SHALL log `[browser-host] register host=<hostId> profiles=<n> pin=<new|ok|mismatch>`, exactly one `[browser-host] connect host=<hostId> profile=<dir> outcome=<status|reason> ms=<n>` per host-targeted connect, and `[browser-host] link close host=<hostId> reason=<reason>`. Host-level events (refused register, pin mismatch, dropped `browser_host_*`, early `ext_open`, `browser_host:local-ignored`) SHALL be appended to the audit ring under profile key `host:<hostId>` and SHALL be readable via `GET /api/browser/audit?profile=host:<hostId>`. `browser_relay_status` instances SHALL carry `host`. No log line, audit entry, status or REST body SHALL contain a guid, `linkId`, nonce, signature, pairing token or frame data.

#### Scenario: Connect is traceable without secrets
- **WHEN** an operator connect completes
- **THEN** exactly one `[browser-host] connect` line with `outcome=200` SHALL be logged, and neither the logs nor the audit SHALL contain the guid or the `linkId`
