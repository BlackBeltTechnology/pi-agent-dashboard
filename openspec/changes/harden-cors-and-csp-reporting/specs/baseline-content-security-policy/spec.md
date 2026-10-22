## MODIFIED Requirements

### Requirement: Mode-dependent header emission

The server SHALL emit, in `report` mode, two report-only policies: the `baseline` policy (the current policy, with `'unsafe-inline'` and `'unsafe-eval'` in `script-src`) and the `strict` policy (nonce-based `script-src`). In `enforce` mode it SHALL emit the `strict` policy as an enforcing header and SHALL NOT emit the `baseline` policy as a report-only header; it MAY additionally emit a `Content-Security-Policy-Report-Only` header that carries only report-only directives owned by other requirements (for example Trusted Types) and the report destination for them. In `off` mode it SHALL emit no baseline CSP header. Every emitted header carrying the `baseline` or `strict` policy SHALL name the CSP report endpoint for its own policy label as its violation destination, except in Vite dev mode (see "Strict policy is not emitted in Vite dev mode"). A route-level per-response policy that a route sets itself (the `/api/file/raw` active-content sandbox policy, a `ctx.serveApp` mount policy) is not the baseline CSP: the mode SHALL NOT add, remove or rewrite it, and the absence clauses below apply to the baseline header only. The Trusted Types directive is governed by its own mode (see "Independent Trusted Types mode"); a header emitted only to carry that directive is not the baseline CSP and does not violate the absence clauses below. The Trusted Types directive keeps its existing topology: when its mode equals the CSP mode it is appended to the header of that mode (the `baseline` Report-Only header in `report`, the strict enforcing header in `enforce`) and reports to that header's own label; when the modes differ, a header of the other kind carries it alone and SHALL name the CSP report endpoint labelled `trusted-types` as its violation destination.

#### Scenario: Report mode emits report-only header
- **WHEN** the mode is `report`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy-Report-Only` header carrying the `baseline` policy
- **AND** the response SHALL include a `Content-Security-Policy-Report-Only` header carrying the `strict` policy
- **AND** the response SHALL NOT include a `Content-Security-Policy` header carrying the baseline directives, unless the route set a per-response policy itself

#### Scenario: Enforce mode emits enforcing header
- **WHEN** the mode is `enforce`
- **AND** the server responds to a request for one of its own paths
- **THEN** the response SHALL include a `Content-Security-Policy` header carrying the `strict` policy
- **AND** the response SHALL NOT include a `Content-Security-Policy-Report-Only` header carrying the `baseline` policy

#### Scenario: Enforce mode may carry other requirements' report-only directives
- **GIVEN** another requirement defines a directive that is report-only by design
- **WHEN** the mode is `enforce`
- **THEN** the response MAY include a `Content-Security-Policy-Report-Only` header carrying only those directives and their report destination
- **AND** the `strict` policy SHALL remain the only enforcing baseline policy

#### Scenario: Every emitted header reports to the sink for its label
- **WHEN** the mode is `report` or `enforce` and the server is not proxying Vite dev
- **THEN** the header carrying the `baseline` policy SHALL direct violation reports to the sink path labelled `baseline`
- **AND** the header carrying the `strict` policy SHALL direct violation reports to the sink path labelled `strict`

#### Scenario: Matching modes append the Trusted Types directive
- **WHEN** the Trusted Types mode and the CSP mode are both `report`
- **THEN** the Trusted Types directive SHALL be appended to the `baseline` Report-Only header, not to the `strict` one
- **WHEN** both are `enforce`
- **THEN** it SHALL be appended to the strict enforcing header
- **AND** in both cases no separate Trusted Types-only header SHALL be emitted

#### Scenario: Trusted Types header reports to its own label
- **WHEN** the Trusted Types mode differs from the CSP mode and a header carries only the Trusted Types directive
- **THEN** that header SHALL direct violation reports to the sink path labelled `trusted-types`
- **AND** its presence SHALL NOT depend on the CSP mode

#### Scenario: Off mode emits no header
- **WHEN** the mode is `off`
- **AND** the Trusted Types mode is `off`
- **THEN** the server SHALL register no CSP hook
- **AND** no baseline CSP header SHALL be added to any response

#### Scenario: Route-level policy is independent of the mode
- **GIVEN** a route sets its own per-response `Content-Security-Policy`
- **WHEN** the mode is `off`, `report` or `enforce`
- **THEN** the response carries that route's `Content-Security-Policy` value unchanged

### Requirement: Baseline policy directives

The baseline CSP header value SHALL contain the baseline directives that restrict script execution, framing, object embedding, and base URI while permitting same-origin resources plus the specific inline-style/worker/websocket allowances the dashboard requires. The `strict` policy and the `baseline` policy SHALL differ only in `script-src`. A route-level per-response policy is not bound by this directive set.

#### Scenario: Policy directive set
- **WHEN** the server emits the strict policy
- **THEN** the header value SHALL contain `default-src 'self'`
- **AND** on an HTML document it SHALL contain a `script-src` of `'self'` plus a per-response `'nonce-…'` source and no other script source
- **AND** it SHALL contain `style-src 'self' 'unsafe-inline'`
- **AND** it SHALL contain `img-src 'self' data: blob:`
- **AND** it SHALL contain `font-src 'self' data:`
- **AND** it SHALL contain `worker-src 'self' blob:`
- **AND** it SHALL contain `connect-src 'self' ws: wss:`
- **AND** it SHALL contain `frame-src 'self'`
- **AND** it SHALL contain `object-src 'none'`
- **AND** it SHALL contain `base-uri 'self'`
- **AND** it SHALL contain `frame-ancestors 'self'`

#### Scenario: Current policy directive set
- **WHEN** the server emits the `baseline` policy in `report` mode
- **THEN** it SHALL contain `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
- **AND** every other baseline directive SHALL match the `strict` policy

### Requirement: Runtime plugin loading fits the baseline policy

Runtime plugin client loading SHALL work under the strict policy in `enforce` mode, without relaxing the strict policy's directives. The inline import map carries the per-response script nonce. Plugin modules, stylesheets and host shims load from same-origin URLs, which `'self'` covers. Runtime plugin loading SHALL NOT add `blob:`, `data:`, `'unsafe-inline'` or `'unsafe-eval'` to `script-src`.

#### Scenario: Enforce mode renders a runtime claim
- **WHEN** `PI_DASHBOARD_CSP=enforce` and a trusted runtime plugin's claim renders
- **THEN** the claim SHALL render and its styles SHALL apply with zero CSP violations

#### Scenario: Blob import stays blocked
- **WHEN** code attempts `import(URL.createObjectURL(blob))` under `enforce`
- **THEN** the browser SHALL block it, and the baseline policy SHALL NOT be relaxed to allow it

## ADDED Requirements

### Requirement: Strict policy uses a per-response script nonce
The `strict` policy SHALL allow inline script only through a fresh, unpredictable nonce generated per HTML response, and SHALL NOT contain `'unsafe-inline'` or `'unsafe-eval'` in `script-src`. The inline import map SHALL carry that response's nonce. Server-rendered pages (the passkey pages) SHALL contain no inline script: their script SHALL be served as static same-origin assets covered by `'self'`.

#### Scenario: Nonce differs per response
- **WHEN** the server serves the dashboard `index.html` twice
- **THEN** the two `script-src` nonces SHALL differ
- **AND** each response's inline import map SHALL carry that response's nonce

#### Scenario: Passkey pages need no inline script
- **WHEN** the server serves a passkey page under `enforce`
- **THEN** the page SHALL contain no inline `<script>` body
- **AND** its script SHALL load from a same-origin static asset
- **AND** the page SHALL work with zero CSP violations

#### Scenario: Non-HTML response carries the strict header without a nonce
- **WHEN** the server serves a non-HTML response (such as a JSON or asset response) with the strict policy
- **THEN** the header SHALL be present, its `script-src` SHALL be `'self'` with no nonce source, and no nonce SHALL be generated

#### Scenario: Inline script without the nonce is blocked
- **WHEN** the mode is `enforce` and a page contains an inline script lacking the nonce
- **THEN** the browser SHALL block it

### Requirement: Strict policy is not emitted in Vite dev mode
While the server proxies the Vite development server, it SHALL NOT emit the `strict` policy at all, in any mode, neither report-only nor enforcing, so the dev toolchain's inline preamble keeps working. In that state any `baseline` header SHALL carry no report destination, so dev traffic never feeds the violation counters. Production mode SHALL be unaffected.

#### Scenario: Dev mode emits no strict header
- **WHEN** the server runs with `--dev` proxying Vite and the mode is `report` or `enforce`
- **THEN** no response SHALL carry the `strict` policy in any header

#### Scenario: Dev mode never feeds the counter
- **WHEN** the server runs with `--dev` proxying Vite
- **THEN** no emitted CSP header SHALL name a `/__pi/csp-report/` destination for the `baseline` or `strict` policy

#### Scenario: Production mode emits strict
- **WHEN** the server runs in production mode and the mode is `enforce`
- **THEN** responses SHALL carry the `strict` policy in an enforcing header

### Requirement: Dev mode is decided per response
Vite dev handling SHALL be decided per response: only a response actually proxied to Vite is a dev response. In `enforce` mode a dev response SHALL carry the `baseline` policy, with its legacy dev `script-src`, as an enforcing header. No dev response header, including one carrying the Trusted Types directive, SHALL name a report destination.

#### Scenario: Server-owned response in a dev run is not a dev response
- **WHEN** the server runs with `--dev` and answers a request from its own handler rather than Vite
- **THEN** that response SHALL carry the normal mode-dependent headers

#### Scenario: Dev response in enforce mode
- **WHEN** the mode is `enforce` and a response is proxied to Vite
- **THEN** it SHALL carry the `baseline` policy as an enforcing `Content-Security-Policy` header and no `strict` policy

#### Scenario: Dev response with Trusted Types names no destination
- **WHEN** the Trusted Types mode is `report` or `enforce` and a response is proxied to Vite
- **THEN** no header on it SHALL carry a `report-uri`, `report-to` or `/__pi/csp-report/` destination

### Requirement: Baseline CSP violation report sink
The server SHALL expose `POST /__pi/csp-report/:policy` (`:policy` = `baseline`, `strict` or `trusted-types`) accepting `application/csp-report` and `application/reports+json`. It SHALL need no session credential (reachable from signed-out pages, including under OAuth), apply host admission, answer `204` with an empty body on acceptance, and never reflect the report.

#### Scenario: Legacy report accepted
- **WHEN** a browser POSTs an `application/csp-report` body to `/__pi/csp-report/strict`
- **THEN** the server SHALL respond `204` with no body

#### Scenario: Reporting API report accepted
- **WHEN** a browser POSTs an `application/reports+json` body to `/__pi/csp-report/baseline`
- **THEN** the server SHALL respond `204` with no body

#### Scenario: Sink needs no session credential
- **WHEN** a report arrives without any session or device credential from a host admitted by host admission
- **THEN** the server SHALL accept it as above

#### Scenario: Signed-out page reports reach the sink under OAuth
- **WHEN** OAuth authentication is enabled and the login or a passkey page, loaded with no session, emits a violation report
- **THEN** the report SHALL be accepted, not redirected to `/auth/login` or refused `401`

#### Scenario: Unknown policy label refused
- **WHEN** a POST targets `/__pi/csp-report/other` (any label outside `baseline`, `strict` and `trusted-types`)
- **THEN** the server SHALL respond `404` and SHALL NOT count the report

### Requirement: Baseline CSP report sink request handling
The sink SHALL answer a non-POST method with 405 and `Allow: POST`, and a body that is empty, malformed, not a CSP report or content-encoded (such as gzip) with 400, uncounted. An `application/reports+json` array SHALL count each element. A report's directive is its `effective-directive` or `effectiveDirective`, else the first token of `violated-directive`, lowercased. Refusals apply in the order 404, 429, 415, 413.

#### Scenario: Non-POST method refused
- **WHEN** a request that passes the auth gate uses a method other than POST on a sink path
- **THEN** the server SHALL respond `405` with `Allow: POST`

#### Scenario: Unusable body refused
- **WHEN** a POST body is empty, malformed JSON, valid JSON that is not a CSP report, or carries a `Content-Encoding` such as gzip
- **THEN** the server SHALL respond `400` and SHALL NOT count it

#### Scenario: Reporting API batch counts each element
- **WHEN** an `application/reports+json` array of three reports is accepted
- **THEN** three counter increments SHALL be recorded and the limiter SHALL charge one token for the POST

#### Scenario: Directive key selection
- **WHEN** a report carries `effective-directive`, `effectiveDirective` or only `violated-directive: "Script-Src-Elem 'self'"`
- **THEN** the counted directive SHALL be the effective-directive value, else the lowercased first token of `violated-directive`

#### Scenario: Refusal precedence
- **WHEN** a request would fail several checks
- **THEN** unknown label (404) SHALL win over rate limit (429), which SHALL win over content type (415), which SHALL win over size (413)
- **AND** every request that reaches the limiter SHALL consume one token, including those then refused 415 or 413

### Requirement: Baseline CSP report sink slow-body deadline
The sink SHALL stop reading a request body 5 seconds after it starts and respond `408`. The report SHALL NOT be counted and the `dropped` counter SHALL increase by one.

#### Scenario: Slow body times out
- **WHEN** a POST body is sent so slowly that it is incomplete after 5 seconds
- **THEN** the server SHALL respond `408`, SHALL NOT count the report, and the `dropped` counter SHALL increase by one

### Requirement: Baseline CSP report sink resource limits
The sink SHALL enforce an 8 KiB body cap by counting the bytes it reads and aborting at the cap, chunked bodies included, independent of `Content-Length`, the framework body limit and parser registration order. It SHALL apply a per-socket-peer token-bucket limit (capacity 20, refilled at 1 token per second, i.e. 60 reports per minute) that exempts no peer, and refuse any other content type with `415`.

#### Scenario: Oversized body refused
- **WHEN** a POST body exceeds 8 KiB
- **THEN** the server SHALL respond `413` and SHALL NOT count the report as a violation
- **AND** the `dropped` counter SHALL increase by one

#### Scenario: Chunked oversize body refused
- **WHEN** a POST sends a `Transfer-Encoding: chunked` body with no `Content-Length` that exceeds 8 KiB
- **THEN** the server SHALL stop reading at the cap, respond `413` and SHALL NOT count the report
- **AND** the `dropped` counter SHALL increase by one

#### Scenario: Understated Content-Length does not bypass the cap
- **WHEN** a POST declares a `Content-Length` under 8 KiB but sends more than 8 KiB
- **THEN** the server SHALL respond `413` and SHALL NOT count the report

#### Scenario: Size cap does not depend on registration order
- **WHEN** the live-preview CSP sink, which keeps its own 64 KiB cap, is registered before or after this sink
- **THEN** this sink SHALL still refuse bodies over 8 KiB with `413`
- **AND** the live-preview sink SHALL still accept bodies up to its own cap

#### Scenario: Other content type refused
- **WHEN** a POST carries any other content type
- **THEN** the server SHALL respond `415` and SHALL NOT count the report

#### Scenario: Flood is rate limited
- **WHEN** one socket peer sends more than 60 reports in a minute, or more than 20 in a burst
- **THEN** the excess SHALL receive `429` and SHALL NOT be counted as violations
- **AND** the `dropped` counter SHALL increase by one for each refused report

#### Scenario: Bucket refills at one token per second
- **WHEN** one peer has used all 20 tokens and waits 5 seconds
- **THEN** about 5 further reports SHALL be accepted before `429`

#### Scenario: Loopback peers are rate limited too
- **WHEN** reports arrive over a tunnel, so the socket peer is loopback, faster than the rate limit
- **THEN** the excess SHALL receive `429`

#### Scenario: Limit is per socket peer
- **WHEN** one peer exhausts its limit
- **THEN** a different socket peer's reports SHALL still be accepted

#### Scenario: Input is never reflected
- **WHEN** a report contains markup or an attacker-chosen string
- **THEN** no response body or header SHALL contain any part of it

### Requirement: Violation counter is observable and persistent
The server SHALL count accepted reports by policy label (`baseline`/`strict`/`trusted-types`) and violated directive, persisting counts and a `since` timestamp across restarts. Unrecognized directives SHALL count under `other`; Trusted Types violations under their own `require-trusted-types-for` bucket, never toward the strict `script-src*` measure. A `dropped` counter SHALL count reports refused by the rate limit or size cap.

#### Scenario: Report increments the matching counter
- **WHEN** a `strict`-labelled report for `script-src-elem` is accepted
- **THEN** the counter for policy `strict`, directive `script-src-elem` SHALL increase by one

#### Scenario: Unknown directive is bucketed
- **WHEN** a report names a directive outside the CSP directive set
- **THEN** it SHALL be counted under `other`
- **AND** no new counter key SHALL be created from the report text

#### Scenario: Trusted Types violations have their own bucket
- **WHEN** an accepted report names the violated directive `require-trusted-types-for`
- **THEN** it SHALL increase the `require-trusted-types-for` counter
- **AND** no `script-src*` counter SHALL change
- **AND** the strict `script-src*` measure, the sum of the `strict` counters whose directive begins `script-src`, SHALL NOT include it

#### Scenario: Refused reports are counted as dropped
- **WHEN** a report is refused by the rate limit or the size cap
- **THEN** the `dropped` counter SHALL increase by one and no directive counter SHALL change

#### Scenario: Counter survives a restart
- **GIVEN** the counters, including `dropped`, are non-zero
- **WHEN** the server restarts
- **THEN** the counters SHALL retain their values and the same `since` timestamp
- **AND** the persisted counter file SHALL be readable only by the server's user

#### Scenario: Forged reports only delay enforcement
- **WHEN** a client forges reports to inflate the counters
- **THEN** only the counter values SHALL change
- **AND** no server behavior, including the enforcement mode, SHALL change as a result

### Requirement: Violation counter degrades safely
A counter-file write failure SHALL NOT change the sink's `204`; counting SHALL continue in memory with one warning. A counter file that is corrupt at boot SHALL be moved to `csp-reports.json.corrupt` and counting SHALL start at zero with a new `since`. When counters cannot be read for the health report, `cspReports` SHALL be omitted.

#### Scenario: Write failure keeps counting
- **WHEN** persisting the counters fails
- **THEN** reports SHALL still be answered `204` and counted in memory, and one warning SHALL be logged

#### Scenario: Corrupt file at boot
- **WHEN** the counter file is unparseable at server start
- **THEN** it SHALL be moved to `csp-reports.json.corrupt`, counters SHALL start at zero with a new `since`, and the server SHALL start normally

#### Scenario: Read failure omits the health block
- **WHEN** the counters cannot be read while serving `GET /api/health`
- **THEN** the response SHALL omit `cspReports` and SHALL NOT fail

### Requirement: Violation counters are flushed promptly
Counter changes SHALL be written to the counter file within 5 seconds of the change, and on graceful shutdown.

#### Scenario: Graceful shutdown flushes
- **WHEN** a report is counted and the server shuts down gracefully before the debounce elapses
- **THEN** the next start SHALL show that count

### Requirement: Violation counters reset only by explicit operator action
The counters, including `dropped`, SHALL reset only by `POST /api/csp-reports/reset`, which requires the `operate` tier and is entered in the route→tier map, or by deleting the counter file while the server is stopped. Both set a new `since`. The reset SHALL NOT touch the in-memory client counters served by the existing `/api/csp-violations` routes. No restart, upgrade or other event SHALL reset them.

#### Scenario: Reset route zeroes the counters
- **WHEN** an `operate`-tier caller posts to `/api/csp-reports/reset`
- **THEN** all counters, including `dropped`, SHALL return to zero and `since` SHALL become the reset time

#### Scenario: Reset response shape
- **WHEN** an `operate`-tier caller posts to `/api/csp-reports/reset`
- **THEN** the response SHALL be `200` with body `{"success":true,"since":"<ISO-8601>"}`

#### Scenario: Lower tier cannot reset
- **WHEN** a device bearer with tier `observe` or `control` posts to `/api/csp-reports/reset`
- **THEN** the server SHALL respond 403 with `scope="operate"` and the counters SHALL be unchanged

#### Scenario: Deleting the file while stopped resets
- **WHEN** the counter file is deleted while the server is stopped and the server then starts
- **THEN** all counters SHALL start at zero with a new `since`

#### Scenario: Restart or upgrade does not reset
- **WHEN** the server restarts or is upgraded with the counter file present
- **THEN** the counters and `since` SHALL be unchanged

### Requirement: Violation counters appear in the health report only when disclosure is permitted
`GET /api/health` SHALL include an optional `cspReports` block carrying the per-policy, per-directive counts, `dropped` and `since`, present only when the access-posture disclosure predicate (`canDiscloseAccessPosture`) passes for the caller. For any other caller the block SHALL be omitted and the health response SHALL otherwise be unchanged. The block carries counts only, never report content.

#### Scenario: Disclosure-permitted caller sees the block
- **WHEN** a caller for whom access-posture disclosure is permitted requests `GET /api/health`
- **THEN** the response SHALL include `cspReports` with the counts, `dropped` and `since`

#### Scenario: Block shape carries counts only
- **WHEN** the block is present
- **THEN** it SHALL be `{ since, dropped, counts: { <policy>: { <directive>: n } } }` with `since` an ISO-8601 timestamp and no URL, path or report content

#### Scenario: Other callers get the block omitted
- **WHEN** a caller for whom access-posture disclosure is not permitted requests `GET /api/health`
- **THEN** the response SHALL contain no `cspReports` field and no count
- **AND** the request SHALL NOT be refused on that account

#### Scenario: Predicate ignores strict mode
- **WHEN** `requireLocalProof` is enabled and a bare loopback caller requests `GET /api/health`
- **THEN** the `cspReports` block SHALL follow the same decision as the existing access-posture disclosure
