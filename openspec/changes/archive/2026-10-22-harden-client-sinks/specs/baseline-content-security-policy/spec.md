# Spec Delta

## MODIFIED Requirements

### Requirement: Mode-dependent header emission

The server SHALL emit the baseline CSP as a report-only header in `report` mode and as an enforcing header in `enforce` mode, and SHALL emit no baseline CSP header when the mode is `off`. A route-level per-response policy that a route sets itself (the `/api/file/raw` active-content sandbox policy, a `ctx.serveApp` mount policy) is not the baseline CSP: the mode SHALL NOT add, remove or rewrite it, and the absence clauses below apply to the baseline header only. The Trusted Types directive is governed by its own mode (see "Independent Trusted Types mode"); a header emitted only to carry that directive is not the baseline CSP and does not violate the absence clauses below.

#### Scenario: Report mode emits report-only header
- **WHEN** the mode is `report`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy-Report-Only` header
- **AND** the response SHALL NOT include a `Content-Security-Policy` header carrying the baseline directives, unless the route set a per-response policy itself

#### Scenario: Enforce mode emits enforcing header
- **WHEN** the mode is `enforce`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy` header
- **AND** the response SHALL NOT include a `Content-Security-Policy-Report-Only` header carrying the baseline directives

#### Scenario: Off mode emits no header
- **WHEN** the mode is `off`
- **AND** the Trusted Types mode is `off`
- **THEN** the server SHALL register no CSP hook
- **AND** no baseline CSP header SHALL be added to any response

#### Scenario: Route-level policy is independent of the mode
- **GIVEN** a route sets its own per-response `Content-Security-Policy`
- **WHEN** the mode is `off`, `report` or `enforce`
- **THEN** the response carries that route's `Content-Security-Policy` value unchanged

## ADDED Requirements

### Requirement: Independent Trusted Types mode
The server SHALL resolve a Trusted Types mode from `PI_DASHBOARD_TRUSTED_TYPES` into `off`, `report`, or `enforce`. When unset or unrecognized, it SHALL resolve to `off` if the baseline CSP mode is `off`, and to `report` otherwise. The Trusted Types mode SHALL NOT change the baseline CSP mode, and SHALL NOT remove or alter any directive required by "Baseline policy directives"; it may only add `require-trusted-types-for 'script'`.

#### Scenario: Default follows an enabled baseline
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES` is unset and `PI_DASHBOARD_CSP` is unset or `enforce`
- **THEN** the Trusted Types mode resolves to `report`

#### Scenario: Default follows a disabled baseline
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES` is unset and `PI_DASHBOARD_CSP` is `off`
- **THEN** the Trusted Types mode resolves to `off`

#### Scenario: Existing enforce users are not escalated
- **WHEN** `PI_DASHBOARD_CSP=enforce` and `PI_DASHBOARD_TRUSTED_TYPES` is unset
- **THEN** Trusted Types is reported, not enforced

#### Scenario: Explicit enforce
- **WHEN** `PI_DASHBOARD_TRUSTED_TYPES=enforce`
- **THEN** the Trusted Types mode resolves to `enforce` whatever the baseline mode

### Requirement: Trusted Types directive emission
In `report` mode the server SHALL deliver `require-trusted-types-for 'script'` through a report-only policy, and in `enforce` mode through an enforcing policy. It SHALL appear only in headers the baseline hook itself adds, never inside a route-level policy, and the served document SHALL state the active mode. In `off` mode, and under skipped proxied prefixes, no response carries it.

#### Scenario: Report with report baseline
- **WHEN** the baseline mode is `report` and the Trusted Types mode is `report`
- **THEN** the dashboard document's report-only policy contains `require-trusted-types-for 'script'`
- **AND** no enforcing policy contains it

#### Scenario: Report with enforce baseline
- **WHEN** the baseline mode is `enforce` and the Trusted Types mode is `report`
- **THEN** the enforcing baseline policy does not contain the directive
- **AND** a report-only policy containing only the directive is present

#### Scenario: Enforce
- **WHEN** the Trusted Types mode is `enforce`
- **THEN** an enforcing policy on the dashboard document contains `require-trusted-types-for 'script'`

#### Scenario: Route-level enforcing policy untouched
- **GIVEN** a plugin app mount sets its own enforcing `Content-Security-Policy`
- **WHEN** the Trusted Types mode is `enforce`
- **THEN** the mount's policy value is unchanged and carries no added directive

#### Scenario: Document states the mode
- **WHEN** the dashboard document is served with the Trusted Types mode `report`
- **THEN** the document tells the client that the mode is `report`

#### Scenario: Proxied prefix untouched
- **WHEN** a request URL begins with `/live/`
- **THEN** the response carries no Trusted Types directive from the dashboard
