## MODIFIED Requirements

### Requirement: Violation counter is observable and persistent
The server SHALL count accepted reports by policy label (`baseline`/`strict`/`trusted-types`) and violated directive, persisting counts and a `since` timestamp across restarts. Unrecognized directives SHALL count under `other`; Trusted Types violations under their own `require-trusted-types-for` bucket, never toward the strict `script-src*` measure. A `dropped` counter SHALL count reports refused by the rate limit or size cap. The server SHALL also persist, in the same counter file, a Trusted Types shadow block with exactly the fixed keys `would-block-script`, `would-block-script-url`, `would-alter-html`, `would-throw-html`, `not-evaluated` and `shadow-error`, plus its own shadow `since`. The block is fed only by the known keys of the shadow aggregate of accepted client violation reports. Shadow counts SHALL NOT enter any `policy × directive` counter or the strict `script-src*` measure. Whenever the shadow block starts from zero for any reason other than the operator reset, which includes a new store, a counter file without the block, and a malformed block, the shadow `since` SHALL be set to that moment and the other counters and the core `since` SHALL be kept.

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

#### Scenario: Shadow aggregate increments the shadow block
- **WHEN** an accepted client violation report carries the shadow aggregate `would-block-script-url: 2`
- **THEN** the persisted shadow counter `would-block-script-url` SHALL increase by 2
- **AND** no `policy × directive` counter, including `other`, SHALL change

#### Scenario: Per-source shadow entries are not persisted
- **WHEN** an accepted client violation report carries an entry with directive `trusted-types-shadow` but no shadow aggregate
- **THEN** no persisted counter SHALL change
- **AND** no new persisted key SHALL be created from the report text

#### Scenario: Refused client report changes no shadow counter
- **WHEN** a client violation report carrying a shadow aggregate is refused by the rate limit, the size cap or the schema
- **THEN** no persisted shadow counter SHALL change

#### Scenario: Counter survives a restart
- **GIVEN** the counters, including `dropped` and the shadow block, are non-zero
- **WHEN** the server restarts
- **THEN** the counters SHALL retain their values and the same `since` and shadow `since` timestamps
- **AND** the persisted counter file SHALL be readable only by the server's user

#### Scenario: Counter file without a shadow block
- **WHEN** the server starts with a counter file that has no shadow block, either written before the block existed or rewritten by an older server version
- **THEN** the existing counters and `since` SHALL be kept
- **AND** every shadow counter SHALL start at zero and the shadow `since` SHALL be the start time

#### Scenario: Unknown shadow key in the file is ignored
- **WHEN** the server starts with a counter file whose shadow block carries, besides valid known keys, a key that is not a shadow outcome name
- **THEN** the known shadow counters and the shadow `since` SHALL be loaded unchanged and the unknown key SHALL be dropped

#### Scenario: Malformed shadow block degrades alone
- **WHEN** the server starts with a counter file whose core counters are valid but whose shadow block is not an object or carries a known key with a malformed count
- **THEN** the core counters, `dropped` and `since` SHALL be kept and the file SHALL NOT be treated as corrupt
- **AND** every shadow counter SHALL start at zero, the shadow `since` SHALL be the start time, and one warning SHALL be logged

#### Scenario: Forged reports only delay enforcement
- **WHEN** a client forges reports to inflate the counters
- **THEN** only the counter values SHALL change
- **AND** no server behavior, including the enforcement mode, SHALL change as a result

### Requirement: Violation counter degrades safely
A counter-file write failure SHALL NOT change the sink's `204`; counting SHALL continue in memory with one warning. A counter file whose core counters are corrupt at boot SHALL be moved to `csp-reports.json.corrupt` and counting SHALL start at zero with a new `since`. A malformed Trusted Types shadow block alone SHALL NOT make the file corrupt; only the shadow block restarts, with a new shadow `since`. When counters cannot be read for the health report, `cspReports` SHALL be omitted.

#### Scenario: Write failure keeps counting
- **WHEN** persisting the counters fails
- **THEN** reports SHALL still be answered `204` and counted in memory, and one warning SHALL be logged

#### Scenario: Corrupt file at boot
- **WHEN** the counter file is unparseable at server start
- **THEN** it SHALL be moved to `csp-reports.json.corrupt`, counters SHALL start at zero with a new `since`, and the server SHALL start normally

#### Scenario: Malformed shadow block is not file corruption
- **WHEN** the counter file's core counters are valid and only its shadow block is malformed at server start
- **THEN** the file SHALL NOT be moved to `csp-reports.json.corrupt`
- **AND** the core counters and `since` SHALL be kept, and the shadow counters SHALL start at zero with a new shadow `since`

#### Scenario: Read failure omits the health block
- **WHEN** the counters cannot be read while serving `GET /api/health`
- **THEN** the response SHALL omit `cspReports` and SHALL NOT fail

### Requirement: Violation counters reset only by explicit operator action
The counters, including `dropped` and the Trusted Types shadow block, SHALL reset only by `POST /api/csp-reports/reset`, which requires the `operate` tier and is entered in the route→tier map, or by deleting the counter file while the server is stopped. Both set a new `since`. The reset SHALL NOT touch the in-memory client counters served by the existing `/api/csp-violations` routes. No restart, upgrade or other event SHALL reset them.

#### Scenario: Reset route zeroes the counters
- **WHEN** an `operate`-tier caller posts to `/api/csp-reports/reset`
- **THEN** all counters, including `dropped` and every shadow counter, SHALL return to zero and both `since` and the shadow `since` SHALL become the reset time

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
`GET /api/health` SHALL include an optional `cspReports` block carrying the per-policy, per-directive counts, `dropped` and `since`, present only when the access-posture disclosure predicate (`canDiscloseAccessPosture`) passes for the caller. The block SHALL always carry `ttShadow` with the shadow `since` and the six Trusted Types shadow counts, zeros included, as plain numbers. For any other caller the block SHALL be omitted and the health response SHALL otherwise be unchanged. The block carries counts only, never report content.

#### Scenario: Disclosure-permitted caller sees the block
- **WHEN** a caller for whom access-posture disclosure is permitted requests `GET /api/health`
- **THEN** the response SHALL include `cspReports` with the counts, `dropped` and `since`

#### Scenario: Block shape carries counts only
- **WHEN** the block is present
- **THEN** it SHALL be `{ since, dropped, counts: { <policy>: { <directive>: n } }, ttShadow: { since, "would-block-script": n, "would-block-script-url": n, "would-alter-html": n, "would-throw-html": n, "not-evaluated": n, "shadow-error": n } }` with both `since` values ISO-8601 timestamps and no URL, path, timestamp per shadow key or report content

#### Scenario: Zero shadow counts are reported, not omitted
- **WHEN** every shadow counter is zero, including right after a reset
- **THEN** the `cspReports` block SHALL carry `ttShadow` with its `since` and all six counts set to 0

#### Scenario: Other callers get the block omitted
- **WHEN** a caller for whom access-posture disclosure is not permitted requests `GET /api/health`
- **THEN** the response SHALL contain no `cspReports` field and no count
- **AND** the request SHALL NOT be refused on that account

#### Scenario: Predicate ignores strict mode
- **WHEN** `requireLocalProof` is enabled and a bare loopback caller requests `GET /api/health`
- **THEN** the `cspReports` block SHALL follow the same decision as the existing access-posture disclosure
