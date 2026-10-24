## MODIFIED Requirements

### Requirement: Mode-dependent header emission

The server SHALL emit the baseline CSP as a report-only header in `report` mode and as an enforcing header in `enforce` mode, and SHALL emit no baseline CSP header when the mode is `off`. A route-level per-response policy that a route sets itself (the `/api/file/raw` active-content sandbox policy, a `ctx.serveApp` mount policy) is not the baseline CSP: the mode SHALL NOT add, remove or rewrite it, and the absence clauses below apply to the baseline header only. In `report` mode the report-only header SHALL additionally carry `require-trusted-types-for 'script'`; the enforcing header SHALL NOT carry any Trusted Types directive in this change.

#### Scenario: Report mode emits report-only header
- **WHEN** the mode is `report`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy-Report-Only` header
- **AND** that header SHALL contain `require-trusted-types-for 'script'`
- **AND** the response SHALL NOT include a `Content-Security-Policy` header, unless the route set a per-response policy itself

#### Scenario: Enforce mode emits enforcing header
- **WHEN** the mode is `enforce`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy` header
- **AND** the response SHALL NOT include a `Content-Security-Policy-Report-Only` header
- **AND** the enforcing header SHALL NOT contain `require-trusted-types-for`

#### Scenario: Off mode emits no header
- **WHEN** the mode is `off`
- **THEN** the server SHALL register no CSP hook
- **AND** no baseline CSP header SHALL be added to any response

#### Scenario: Route-level policy is independent of the mode
- **GIVEN** a route sets its own per-response `Content-Security-Policy`
- **WHEN** the mode is `off`, `report` or `enforce`
- **THEN** the response carries that route's `Content-Security-Policy` value unchanged
