## MODIFIED Requirements

### Requirement: Cross-origin CORS-blocked probe is distinct from Unreachable
When an availability probe from the browser fails with no readable response (the transport `.catch()` path), the selector SHALL consult the dashboard server's reachability probe for that entry and render the cause it reports, instead of inferring the cause from the host's address class. The CORS-blocked indicator SHALL be shown only when the dashboard server reaches the target but the browser cannot. The existing HTTP 403 `network_not_allowed` → "Network not allowed" state is preserved.

#### Scenario: LAN host with a blocked probe shows an allowlist hint
- **WHEN** an entry whose host is a private-LAN address (RFC-1918, CGNAT, link-local, or an mDNS `.local` name) is probed cross-origin AND the browser probe throws with no readable response
- **THEN** the allowlist hint SHALL be rendered only if the server-side probe reports `reachable` for that entry
- **AND** the host's address class alone SHALL NOT select the CORS-blocked indicator

#### Scenario: Server reaches the target but the browser cannot
- **WHEN** the browser probe throws with no readable response AND the server-side probe reports `reachable`
- **THEN** the entry SHALL render a distinct indicator stating the server is reachable from the dashboard but not from this browser (CORS or network), with a hint that the remote may need to allowlist this origin
- **AND** the entry SHALL be disabled

#### Scenario: Stale hostname is named as such
- **WHEN** the browser probe throws AND the server-side probe reports `name-not-resolved`
- **THEN** the entry SHALL render "Name not found" with a hint that the server may have been renamed
- **AND** it SHALL NOT render the CORS-blocked indicator

#### Scenario: Moved server offers an update
- **WHEN** the server-side probe reports `name-not-resolved` for an entry and the known-servers listing carries a move suggestion for it
- **THEN** the entry SHALL show "Moved to" with the suggested address and an Update action that accepts the suggestion
- **AND** switching to the entry SHALL remain disabled until the entry has been updated and probes available

#### Scenario: Genuine outage stays Unreachable
- **WHEN** the browser probe throws AND the server-side probe reports `refused`, `timeout`, or `error`
- **THEN** the entry SHALL render "Unreachable"

#### Scenario: Server-side probe unavailable
- **WHEN** the browser probe throws AND the server-side probe request itself fails or is refused
- **THEN** the entry SHALL render "Unreachable"

#### Scenario: Unavailable states block switching
- **WHEN** an entry renders any state other than available
- **THEN** the entry SHALL be disabled for switching

#### Scenario: Existing states unchanged
- **WHEN** a probe returns HTTP 403 with `error: "network_not_allowed"`
- **THEN** the entry SHALL render "Network not allowed"
