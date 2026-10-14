## MODIFIED Requirements

### Requirement: Connect and CDP-URL lifecycle

`POST /api/browser/connect?profile=<profileDirectory>` SHALL mint a guid, open the extension's `connect.html` in that profile with `protocolVersion=2` and, when the profile config sets `zeroDialog: true` and a token is stored, `token=<token>`, and return `{cdpUrl, instanceId}` once the extension handshake completes (timeout 60 s → 504 and the guid expires). The HTTP request SHALL stay open for the whole handshake window, independent of the server's idle connection timeout, and SHALL restore that timeout once the response is sent. The response is the only way to obtain a `cdpUrl`; no lookup endpoint SHALL exist. `POST /api/browser/disconnect?instanceId=<id>` SHALL close that relay instance, detaching its tabs; `instanceId` is required. `PUT /api/browser/enabled {enabled}` SHALL write `plugins.browser.enabled` and, when false, close every instance before responding.

#### Scenario: Zero-dialog token configured

- **WHEN** the profile config has `zeroDialog: true` and a stored token matching the extension's token, and the agent calls `connect`
- **THEN** the extension SHALL attach without a user dialog and `connect` SHALL resolve with a `cdpUrl` on `127.0.0.1` and an `instanceId`

#### Scenario: Default dialog flow

- **WHEN** `zeroDialog` is unset and the agent calls `connect`
- **THEN** the extension SHALL show its Allow/Reject dialog; on Allow `connect` resolves, on Reject or no answer within 60 s `connect` returns 504 and the guid expires

#### Scenario: Token mismatch

- **WHEN** the stored token does not match the extension's token
- **THEN** the extension SHALL refuse inside its own page (nothing reaches the relay), no tab group SHALL be created, and `connect` SHALL return 504 after 60 s exactly as for no answer; the settings section SHALL explain this outcome beside the `Zero-dialog` toggle

#### Scenario: Global kill switch

- **WHEN** `plugins.browser.enabled` is `false` (the plugin remains loaded; this is plugin config, distinct from the loader-level plugin toggle)
- **THEN** every relay endpoint SHALL reject upgrades with 403, every `/api/browser/*` write except `PUT /api/browser/enabled` SHALL return 403, and live instances SHALL have been closed before the `PUT` that flipped the flag responded

#### Scenario: Allow clicked after the server's idle connection timeout

- **WHEN** `zeroDialog` is unset, the agent calls `connect`, and the user clicks Allow after the server's 10 s idle connection timeout but within 60 s
- **THEN** `connect` SHALL respond 200 with `{cdpUrl, instanceId}` on that same request
