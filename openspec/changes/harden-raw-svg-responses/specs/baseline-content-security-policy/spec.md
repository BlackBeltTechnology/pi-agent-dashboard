## MODIFIED Requirements

### Requirement: Mode-dependent header emission

The server SHALL emit the baseline CSP as a report-only header in `report` mode and as an enforcing header in `enforce` mode, and SHALL emit no baseline CSP header when the mode is `off`. A route-level per-response policy that a route sets itself (the `/api/file/raw` active-content sandbox policy, a `ctx.serveApp` mount policy) is not the baseline CSP: the mode SHALL NOT add, remove or rewrite it, and the absence clauses below apply to the baseline header only.

#### Scenario: Report mode emits report-only header
- **WHEN** the mode is `report`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy-Report-Only` header
- **AND** the response SHALL NOT include a `Content-Security-Policy` header, unless the route set a per-response policy itself

#### Scenario: Enforce mode emits enforcing header
- **WHEN** the mode is `enforce`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy` header
- **AND** the response SHALL NOT include a `Content-Security-Policy-Report-Only` header

#### Scenario: Off mode emits no header
- **WHEN** the mode is `off`
- **THEN** the server SHALL register no CSP hook
- **AND** no baseline CSP header SHALL be added to any response

#### Scenario: Route-level policy is independent of the mode
- **GIVEN** a route sets its own per-response `Content-Security-Policy`
- **WHEN** the mode is `off`, `report` or `enforce`
- **THEN** the response carries that route's `Content-Security-Policy` value unchanged

### Requirement: Baseline policy directives

The baseline CSP header value SHALL contain the baseline directives that restrict script execution, framing, object embedding, and base URI while permitting same-origin resources plus the specific inline/eval/worker/websocket allowances the dashboard requires. A route-level per-response policy is not bound by this directive set.

#### Scenario: Policy directive set
- **WHEN** the server emits the baseline CSP header
- **THEN** the header value SHALL contain `default-src 'self'`
- **AND** it SHALL contain `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
- **AND** it SHALL contain `style-src 'self' 'unsafe-inline'`
- **AND** it SHALL contain `img-src 'self' data: blob:`
- **AND** it SHALL contain `font-src 'self' data:`
- **AND** it SHALL contain `worker-src 'self' blob:`
- **AND** it SHALL contain `connect-src 'self' ws: wss:`
- **AND** it SHALL contain `frame-src 'self'`
- **AND** it SHALL contain `object-src 'none'`
- **AND** it SHALL contain `base-uri 'self'`
- **AND** it SHALL contain `frame-ancestors 'self'`
