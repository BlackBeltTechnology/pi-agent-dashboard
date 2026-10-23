## MODIFIED Requirements

### Requirement: Relay endpoints are loopback-only

Both `/ws/browser-ext/<guid>` and `/ws/browser-cdp/<guid>` SHALL be admitted only for genuinely-local peers presenting a live guid in the path AND a valid single-use relay ticket in the `ticket` query parameter. The ticket is minted by the browser plugin for that guid when the connect URL is issued (to a caller the dashboard already admitted at `control`/`operate` tier), is at least 128 bits, expires 60 seconds after issue, is consumed by the first upgrade attempt for that guid and role (`ext` or `cdp`), and is never logged or persisted. A guid without a valid ticket SHALL be refused, so a guid or URL read later from a transcript cannot be replayed. `/ws/browser-cdp/<guid>` SHALL additionally reject any upgrade that carries an `Origin` header (web content always sends one; CDP clients never do). They SHALL NOT be reachable through the tunnel, SHALL NOT accept the dashboard's `/api/ws-ticket` WebSocket tickets (only the plugin's own relay ticket), SHALL NOT be admitted by trusted-CIDR bypass, and SHALL NOT accept a dashboard session cookie or the local IPC token in place of the guid.

#### Scenario: Web page with its own cdpUrl

- **WHEN** a loopback web page obtains a valid `cdpUrl` and opens a WebSocket to it (the browser attaches `Origin`)
- **THEN** the upgrade SHALL be rejected with HTTP 403

#### Scenario: Remote peer

- **WHEN** an upgrade arrives on either relay endpoint from a non-loopback peer, or via the tunnel Host, or presenting a `ticket`
- **THEN** the upgrade SHALL be rejected with HTTP 403 and a `[ws-gate]` log line naming scope and peer

#### Scenario: Replayed relay URL is refused
- **WHEN** a loopback client dials a `/ws/browser-cdp/<guid>?ticket=<t>` URL whose ticket was already consumed or is older than 60 seconds
- **THEN** the upgrade SHALL be refused and no CDP session SHALL attach

#### Scenario: Fresh relay URL works under the default
- **WHEN** `requireLocalProof` is unset and an agent dials the `cdpUrl` returned by a proofed `browser_connect` within 60 seconds
- **THEN** the upgrade SHALL be admitted without any proof header or cookie
