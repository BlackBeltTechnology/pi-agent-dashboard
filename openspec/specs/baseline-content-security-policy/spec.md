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

### Requirement: Runtime plugin loading fits the baseline policy

Runtime plugin client loading SHALL work under the baseline policy in `enforce` mode, without changing the baseline policy's directives. The inline import map relies on `script-src 'unsafe-inline'`. Plugin modules, stylesheets and host shims load from same-origin URLs, which `'self'` covers. Runtime plugin loading SHALL NOT add `blob:` or `data:` to `script-src`.

#### Scenario: Enforce mode renders a runtime claim
- **WHEN** `PI_DASHBOARD_CSP=enforce` and a trusted runtime plugin's claim renders
- **THEN** the claim SHALL render and its styles SHALL apply with zero CSP violations

#### Scenario: Blob import stays blocked
- **WHEN** code attempts `import(URL.createObjectURL(blob))` under `enforce`
- **THEN** the browser SHALL block it, and the baseline policy SHALL NOT be relaxed to allow it

### Requirement: Tightening script-src keeps the import map working

If the baseline replaces `'unsafe-inline'` in `script-src` with nonces or hashes, the same change SHALL stamp the nonce on (or include the hash of) the server-injected import-map tag.

#### Scenario: Nonce-based policy
- **WHEN** the baseline policy switches to a per-response script nonce
- **THEN** the import-map `<script type="importmap">` in every served `index.html` SHALL carry that nonce, and runtime claims SHALL still render under `enforce`
