## MODIFIED Requirements

### Requirement: Staged CSP mode resolution

The server SHALL resolve the CSP mode from the `PI_DASHBOARD_CSP` environment variable into one of three modes: `off`, `report`, or `enforce`. Matching SHALL be exact and case-sensitive. Unrecognized or unset values, the empty string included, SHALL resolve to `enforce`. Explicit `off` and `report` remain available as rollback values. When the variable is set to a non-empty unrecognized value, the server SHALL log exactly one warning at startup that names the variable, the accepted values and the resolved mode, SHALL NOT include the raw value, and SHALL NOT be repeated per request.

#### Scenario: Default when unset
- **WHEN** `PI_DASHBOARD_CSP` is not set
- **THEN** the mode SHALL resolve to `enforce`

#### Scenario: Unrecognized value
- **WHEN** `PI_DASHBOARD_CSP` is set to a value other than `off`, `report`, or `enforce`
- **THEN** the mode SHALL resolve to `enforce`

#### Scenario: Explicit enforce
- **WHEN** `PI_DASHBOARD_CSP` is set to `enforce`
- **THEN** the mode SHALL resolve to `enforce`

#### Scenario: Explicit off
- **WHEN** `PI_DASHBOARD_CSP` is set to `off`
- **THEN** the mode SHALL resolve to `off`

#### Scenario: Explicit report stays available as rollback
- **WHEN** `PI_DASHBOARD_CSP` is set to `report`
- **THEN** the mode SHALL resolve to `report`

#### Scenario: Mistyped value warns once at startup
- **WHEN** `PI_DASHBOARD_CSP` is set to a non-empty value other than `off`, `report`, or `enforce` (for example `REPORT` or `reprot`)
- **THEN** the server SHALL log exactly one startup warning naming `PI_DASHBOARD_CSP`, the accepted values `off`, `report`, `enforce` and the resolved mode `enforce`
- **AND** the warning SHALL NOT contain the raw value
- **AND** serving requests SHALL NOT log the warning again

#### Scenario: Unset or empty does not warn
- **WHEN** `PI_DASHBOARD_CSP` is unset, empty, `off`, `report`, or `enforce`
- **THEN** the server SHALL NOT log the unrecognized-value warning

#### Scenario: Default enforces the strict policy on dashboard-owned responses
- **WHEN** `PI_DASHBOARD_CSP` is not set
- **AND** the server answers a request for one of its own HTML paths from its own handler, not proxied to Vite, on a route that sets no route-level policy itself
- **THEN** the response SHALL carry the `strict` policy as an enforcing `Content-Security-Policy` header
- **AND** the response SHALL NOT carry the `baseline` policy as a `Content-Security-Policy-Report-Only` header
