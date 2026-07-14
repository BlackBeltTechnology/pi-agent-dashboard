## MODIFIED Requirements

### Requirement: Operator-side pairing view renders the payload
The dashboard web client SHALL provide an operator-side pairing view that, on open, calls `GET /api/pair/payload` and renders the returned `{ v, id, code, urls[] }` payload BOTH as a scannable QR code AND as a copyable base64url string. The view SHALL display the server fingerprint `id`, a countdown reflecting the one-time code TTL (~60s), and the list of `urls[]` currently advertised. The countdown SHALL be ADVISORY: it SHALL NOT disable the approval action when it reaches zero, because a redeeming device restarts the code's TTL server-side and the server is the sole authority on validity (it rejects a truly-expired code at approval time).

The view SHALL signpost **scanning the QR with a phone's native camera** as the primary cross-device pairing path: it SHALL display an instruction, adjacent to the QR, that a phone camera can scan the QR directly and that no manual code entry is required. The copyable base64url string SHALL be presented as a SECONDARY fallback for desktop/native paste, carrying a label that identifies it as such (not as the primary phone path). The QR SHALL be rendered at a size legible to a phone camera at typical desk distance (≥ ~180px). This presentation is instructional only; it changes neither the payload, the one-time code TTL, nor the approval flow.

This closes the gap where the existing "pairing view" scenarios in this capability had no web-client implementation: `GET /api/pair/payload` shipped with zero callers.

#### Scenario: Payload rendered on open
- **WHEN** the operator opens the pairing view AND at least one `wss://`-reachable endpoint exists
- **THEN** the view SHALL show a QR encoding the payload AND the same payload as a copyable string
- **AND** the view SHALL show the fingerprint `id` and a TTL countdown for the one-time code

#### Scenario: Camera scan signposted as the primary path
- **WHEN** the operator opens the pairing view with a TLS pairing endpoint selected
- **THEN** the view SHALL show an instruction, adjacent to the QR, that a phone's native camera can scan the QR with no manual code entry
- **AND** the QR SHALL be rendered at ≥ ~180px

#### Scenario: Copy-string labeled as a desktop/paste fallback
- **WHEN** the operator views the pairing panel for a TLS pairing endpoint
- **THEN** the copyable `pi:pair:v1.…` string SHALL be presented as a secondary fallback for desktop/native paste, with a label distinguishing it from the primary camera-scan path
- **AND** the copy-string SHALL remain the bare payload (unchanged), so an Electron/native client can paste it directly

#### Scenario: No secure road → empty state
- **WHEN** `GET /api/pair/payload` returns `no_reachable_endpoint`
- **THEN** the view SHALL explain that a tunnel or a publicly-trusted TLS URL is required to pair a remote device
- **AND** SHALL offer an action to start a tunnel and note the `http://localhost` escape hatch
