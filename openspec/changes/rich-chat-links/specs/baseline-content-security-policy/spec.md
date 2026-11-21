# Spec Delta

## MODIFIED Requirements

### Requirement: Baseline policy directives

The baseline CSP header value SHALL contain the baseline directives that restrict script execution, framing, object embedding, and base URI while permitting same-origin resources plus the specific inline-style/worker/websocket allowances the dashboard requires. The `strict` policy and the `baseline` policy SHALL differ only in `script-src`. A route-level per-response policy is not bound by this directive set. `frame-src` admits same-origin and `https:` frames so editor-pane web tabs can embed external pages that permit it; every other source, including `http:`, `data:` and `blob:` frames, stays blocked.

#### Scenario: Policy directive set
- **WHEN** the server emits the strict policy
- **THEN** the header value SHALL contain `default-src 'self'`
- **AND** on an HTML document it SHALL contain a `script-src` of `'self'` plus a per-response `'nonce-…'` source and no other script source
- **AND** it SHALL contain `style-src 'self' 'unsafe-inline'`
- **AND** it SHALL contain `img-src 'self' data: blob:`
- **AND** it SHALL contain `font-src 'self' data:`
- **AND** it SHALL contain `worker-src 'self' blob:`
- **AND** it SHALL contain `connect-src 'self' ws: wss:`
- **AND** it SHALL contain `frame-src 'self' https:`
- **AND** it SHALL contain `object-src 'none'`
- **AND** it SHALL contain `base-uri 'self'`
- **AND** it SHALL contain `frame-ancestors 'self'`

#### Scenario: Current policy directive set
- **WHEN** the server emits the `baseline` policy in `report` mode
- **THEN** it SHALL contain `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
- **AND** every other baseline directive SHALL match the `strict` policy

#### Scenario: Non-https frame sources stay blocked
- **WHEN** the server emits either policy
- **THEN** `frame-src` SHALL NOT contain `http:`, `data:`, `blob:` or `*`
