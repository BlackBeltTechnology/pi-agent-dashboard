## ADDED Requirements

### Requirement: Non-tunnel endpoint entry via the UI without hand-editing JSON

The dashboard SHALL let an operator add a non-tunnel `https://`/`wss://` pairing endpoint through the UI WITHOUT hand-editing any JSON config file, reusing the existing authenticated config-write path (`PUT /api/config`) — NOT a pairing-specific route. The control SHALL read the current config, append the entered URL to `pairing.publicBaseUrls`, and PUT the full `pairing` object back. After a successful add, the endpoint SHALL join the multi-sourced `getReachableUrls()` so it appears in the "Accessible at" list and, when TLS, in the pairing payload's `urls[]`. The `https`/`wss` gate is enforced server-side at read-time by `reachableUrls()` (D4/D14); any non-secure entry is dropped before advertisement regardless of how it was written.

Migrated from `wire-nonzrok-pairing-view` (Phase 2), because it feeds the same `getReachableUrls()` / `urls[]` source this change already rewrites for multi-provider endpoints. Before this change, `pairing.publicBaseUrls` had no UI affordance — forcing a hand-edit of `~/.pi/dashboard/config.json`.

#### Scenario: Operator adds an HTTPS URL via UI
- **WHEN** the operator submits `https://dashboard.example.com` in the Gateway endpoints "Add HTTPS URL" control
- **THEN** the client SHALL PUT the full `pairing` object (including the appended URL) to `PUT /api/config`
- **AND** the re-fetched endpoint list and pairing payload's `urls[]` SHALL include it
- **AND** no JSON file SHALL have been edited by hand

#### Scenario: Plain-http URL never advertised
- **WHEN** a `http://192.168.1.10:8000` entry reaches `pairing.publicBaseUrls` (via UI or hand-edit)
- **THEN** `reachableUrls()` SHALL omit it from the pairing payload's `urls[]`
- **AND** the UI SHALL reject the entry client-side with a message that only `https`/`wss` endpoints are accepted

#### Scenario: Write path is authenticated
- **WHEN** an unauthenticated request hits `PUT /api/config`
- **THEN** the request SHALL be rejected by the existing auth gate (same gate as `bindHost`/`bypassHosts`)
