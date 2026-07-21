# baseline-content-security-policy Specification

## Purpose

Apply a baseline Content-Security-Policy header to the dashboard server's own responses as defense in depth, constraining script execution and framing. The rollout is staged via the `PI_DASHBOARD_CSP` environment variable so the policy can be observed in report-only mode before being enforced, or disabled entirely. Proxied/embedded prefixes are skipped so their own policies are not overwritten.

## Requirements

### Requirement: Staged CSP mode resolution

The server SHALL resolve the CSP mode from the `PI_DASHBOARD_CSP` environment variable into one of three modes: `off`, `report`, or `enforce`. Unrecognized or unset values SHALL resolve to `report`.

#### Scenario: Default when unset
- **WHEN** `PI_DASHBOARD_CSP` is not set
- **THEN** the mode SHALL resolve to `report`

#### Scenario: Unrecognized value
- **WHEN** `PI_DASHBOARD_CSP` is set to a value other than `off`, `report`, or `enforce`
- **THEN** the mode SHALL resolve to `report`

#### Scenario: Explicit enforce
- **WHEN** `PI_DASHBOARD_CSP` is set to `enforce`
- **THEN** the mode SHALL resolve to `enforce`

#### Scenario: Explicit off
- **WHEN** `PI_DASHBOARD_CSP` is set to `off`
- **THEN** the mode SHALL resolve to `off`

### Requirement: Mode-dependent header emission

The server SHALL emit the CSP as a report-only header in `report` mode and as an enforcing header in `enforce` mode, and SHALL emit no CSP header when the mode is `off`.

#### Scenario: Report mode emits report-only header
- **WHEN** the mode is `report`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy-Report-Only` header
- **AND** the response SHALL NOT include a `Content-Security-Policy` header

#### Scenario: Enforce mode emits enforcing header
- **WHEN** the mode is `enforce`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy` header
- **AND** the response SHALL NOT include a `Content-Security-Policy-Report-Only` header

#### Scenario: Off mode emits no header
- **WHEN** the mode is `off`
- **THEN** the server SHALL register no CSP hook
- **AND** no CSP header SHALL be added to any response

### Requirement: Baseline policy directives

The CSP header value SHALL contain the baseline directives that restrict script execution, framing, object embedding, and base URI while permitting same-origin resources plus the specific inline/eval/worker/websocket allowances the dashboard requires.

#### Scenario: Policy directive set
- **WHEN** the server emits a CSP header
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

### Requirement: Own responses only, skip proxied prefixes

The server SHALL apply the CSP header only to its own responses and SHALL skip any request whose URL begins with a proxied/sandboxed prefix so that the proxied target's own policy is preserved.

#### Scenario: Header applied to dashboard's own path
- **WHEN** the mode is `report` or `enforce`
- **AND** a request URL does not begin with a skipped prefix
- **THEN** the CSP header SHALL be added to the response

#### Scenario: Proxied prefix skipped
- **WHEN** a request URL begins with `/live/`
- **THEN** the server SHALL NOT add any CSP header to the response
- **AND** the payload SHALL be returned unchanged

#### Scenario: Existing header preserved
- **WHEN** the response already has the CSP header set for the active mode
- **THEN** the server SHALL NOT overwrite the existing header value
