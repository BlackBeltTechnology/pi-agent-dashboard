## MODIFIED Requirements

### Requirement: Staged CSP mode resolution

The server SHALL resolve the CSP mode from the `PI_DASHBOARD_CSP` environment variable into one of three modes: `off`, `report`, or `enforce`. Unrecognized or unset values SHALL resolve to `enforce`. Explicit `off` and `report` remain available as rollback values.

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

#### Scenario: Default enforces the strict policy
- **WHEN** `PI_DASHBOARD_CSP` is not set and the server is not in Vite dev mode
- **THEN** the mode SHALL resolve to `enforce`
- **AND** dashboard HTML responses SHALL carry the strict policy as an enforced `Content-Security-Policy` header
