## ADDED Requirements

### Requirement: Restricted preview violation reports are deliverable

The restricted live-preview CSP SHALL name its egress-violation sink with a `report-uri` directive only. It SHALL NOT carry a `report-to` directive, and the server SHALL NOT add a `Reporting-Endpoints` entry to a capability response. A `Reporting-Endpoints` header set by the upstream SHALL pass through unchanged.

#### Scenario: Restricted preview CSP uses report-uri only
- **WHEN** a capability response is served for a preview under the restricted policy
- **THEN** its `Content-Security-Policy` SHALL contain `report-uri` naming the preview's own `__pi/csp-report` path
- **AND** it SHALL NOT contain a `report-to` directive
- **AND** the server SHALL NOT have added a `Reporting-Endpoints` entry

#### Scenario: A sandboxed preview's violation reaches its sink
- **GIVEN** a restricted preview framed in the viewer (opaque origin)
- **WHEN** the previewed page attempts a fetch to an origin outside its egress allowance
- **THEN** the capability sink SHALL accept the browser's `report-uri` POST with `204`
- **AND** the blocked origin SHALL be recorded as a `runtime` egress entry for that preview

#### Scenario: Upstream Reporting-Endpoints passes through
- **GIVEN** a restricted preview whose upstream response sets `Reporting-Endpoints: up="https://example.invalid/r"`
- **WHEN** the capability response is served
- **THEN** its `Reporting-Endpoints` header SHALL equal the upstream value exactly
