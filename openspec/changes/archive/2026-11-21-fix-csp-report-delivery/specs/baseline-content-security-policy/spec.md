## ADDED Requirements

### Requirement: Report destinations are deliverable on plain http

Every CSP report destination emitted for the `baseline`, `strict` and `trusted-types` labels SHALL be a `report-uri` directive naming `/__pi/csp-report/<label>`. Emitted policies SHALL NOT carry `report-to`, and the server SHALL NOT emit a `Reporting-Endpoints` header for them. A browser violation on a plain-`http` install SHALL reach the sink without any rewriting of the headers.

#### Scenario: Report mode headers name report-uri only
- **GIVEN** the response is not proxied to Vite
- **WHEN** the mode is `report`
- **AND** the server responds to `/`
- **THEN** each `Content-Security-Policy-Report-Only` header SHALL contain `report-uri /__pi/csp-report/<label>` for its own label
- **AND** no CSP header SHALL contain a `report-to` directive
- **AND** the response SHALL NOT include a `Reporting-Endpoints` header

#### Scenario: Trusted Types-only header names report-uri only
- **GIVEN** the Trusted Types mode differs from the CSP mode
- **AND** the response is not proxied to Vite
- **WHEN** the server responds to `/`
- **THEN** the header carrying the Trusted Types directive alone SHALL contain `report-uri /__pi/csp-report/trusted-types`
- **AND** it SHALL NOT contain a `report-to` directive

#### Scenario: A real browser violation reaches the counter unmodified
- **GIVEN** a plain-`http` server in `report` mode serving its production client (not proxied to Vite)
- **WHEN** Chromium loads `/` with the server's headers unmodified and an inline script is inserted
- **THEN** the `strict` label's `script-src-elem` count in `/api/health` `cspReports` SHALL increase within 15 seconds
