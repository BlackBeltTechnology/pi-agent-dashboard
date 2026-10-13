## ADDED Requirements

### Requirement: Dashboard SHALL classify every entry in `packages[]` by health status

The server SHALL expose a classifier that reads `~/.pi/agent/settings.json#packages[]` and, for every entry, produces a `PackageHealthReport` whose `status` is one of `ok`, `stale-npm`, `missing-path`, or `duplicate`.

#### Scenario: `ok` status for resolvable entries with a `package.json`

- **GIVEN** a `packages[]` entry whose `installedPath` resolves to a directory containing a readable `package.json`
- **WHEN** the classifier runs
- **THEN** the resulting report SHALL have `status === "ok"`, `resolvedPath` set, and `packageName` + `version` populated from the `package.json`

#### Scenario: `stale-npm` status for uninstalled npm packages

- **GIVEN** an entry whose source begins with `npm:` and whose corresponding npm-global install directory does not exist
- **WHEN** the classifier runs
- **THEN** the report SHALL have `status === "stale-npm"` and `resolvedPath` SHALL be undefined

#### Scenario: `missing-path` status for dead local or git entries

- **GIVEN** an entry whose source is a local absolute path, a git URL, or an https URL, and whose expected install directory does not exist on disk
- **WHEN** the classifier runs
- **THEN** the report SHALL have `status === "missing-path"`

#### Scenario: `duplicate` status for entries sharing a `package.json#name`

- **GIVEN** two or more `ok`-eligible entries whose enriched `package.json#name` values are identical
- **WHEN** the classifier runs
- **THEN** every member SHALL have `status === "duplicate"` and a shared `duplicateGroupId` derived deterministically from the package name

#### Scenario: Empty input is well-defined

- **GIVEN** `packages[]` is empty or absent
- **WHEN** the classifier runs
- **THEN** the result SHALL be `{ entries: [], summary: { ok: 0, staleNpm: 0, missingPath: 0, duplicateGroups: [] } }`

### Requirement: Server SHALL expose `GET /api/packages/health`

The server SHALL serve `GET /api/packages/health` returning `{ entries: PackageHealthReport[], summary: PackageHealthSummary }`. The route SHALL require authentication on par with other `/api/packages/*` routes.

#### Scenario: Authenticated request returns full report

- **GIVEN** a valid JWT for an allowlisted user
- **WHEN** `GET /api/packages/health` is called
- **THEN** the response SHALL be 200 with the full classified report

#### Scenario: Unauthenticated request is rejected

- **GIVEN** no auth header
- **WHEN** auth is enabled and `GET /api/packages/health` is called
- **THEN** the response SHALL be 401 with no body leak

### Requirement: Server SHALL expose `POST /api/packages/cleanup`

The server SHALL serve `POST /api/packages/cleanup` accepting `{ drop: string[] }` where each member is a verbatim `packages[]` source string to remove. The route SHALL atomically rewrite `~/.pi/agent/settings.json` minus those entries and write a timestamped backup before mutation.

#### Scenario: Successful cleanup of multiple entries

- **GIVEN** `packages[]` contains 13 entries
- **WHEN** `POST /api/packages/cleanup` is called with `{ drop: [<7 valid sources>] }`
- **THEN** the response SHALL be 200 with `{ before: 13, after: 6, dropped: [<7 sources>], backupPath: "~/.pi/agent/settings.json.<ts>.bak" }`
- **AND** the on-disk `settings.json#packages` SHALL contain exactly the 6 untouched entries
- **AND** all other top-level keys in `settings.json` SHALL be preserved bit-identically

#### Scenario: Unknown source rejects the entire request

- **GIVEN** `packages[]` contains entries A, B, C
- **WHEN** the cleanup body is `{ drop: ["A", "DOES-NOT-EXIST"] }`
- **THEN** the response SHALL be 400 with `{ unknown: ["DOES-NOT-EXIST"] }`
- **AND** `settings.json` SHALL be unchanged
- **AND** no backup SHALL be written

#### Scenario: Empty drop list is a successful no-op

- **WHEN** the cleanup body is `{ drop: [] }`
- **THEN** the response SHALL be 200 with `before === after`
- **AND** no backup SHALL be written

#### Scenario: Backup is created before mutation

- **GIVEN** a valid cleanup request
- **WHEN** the request is processed
- **THEN** `~/.pi/agent/settings.json.<ISO-ts>.bak` SHALL exist with the pre-mutation contents
- **AND** the mutation SHALL be atomic (no observer can read a half-written file)

### Requirement: Server SHALL log a one-line health summary at boot when issues exist

After `reconcilePluginBridgePackages` completes during server startup, the server SHALL run the health scanner once and, if any entry has a non-`ok` status, emit a single INFO log line summarising the result. Boot SHALL NOT auto-remove or mutate entries.

#### Scenario: Clean settings produces no log line

- **GIVEN** every `packages[]` entry classifies as `ok`
- **WHEN** the server starts
- **THEN** no `[package-health]` log line SHALL be emitted

#### Scenario: Mixed-status settings produce one summary line

- **GIVEN** `packages[]` has 13 entries with 6 ok, 4 stale-npm, 2 missing-path, 1 duplicate-group of size 2
- **WHEN** the server starts
- **THEN** exactly one line matching `[package-health] 13 entries: 6 ok, 4 stale-npm, 2 missing-path, 1 duplicate-group` SHALL be logged at INFO

#### Scenario: Scanner failure must not crash boot

- **GIVEN** the scanner throws (e.g. unreadable `settings.json`)
- **WHEN** the server starts
- **THEN** boot SHALL complete normally and the failure SHALL be logged at WARN with the error message but no stack-trace surfacing in the user-visible log

### Requirement: Settings UI SHALL surface health issues in the Packages section

`UnifiedPackagesSection.tsx` SHALL fetch `/api/packages/health` on mount and SHALL render a `PackageHealthPanel` above the installed-packages list whenever the summary contains any non-`ok` entries.

#### Scenario: No issues renders nothing

- **GIVEN** the health response has only `ok` entries
- **WHEN** the user opens the Packages section
- **THEN** no health panel SHALL render and no `Issues (N)` badge SHALL appear

#### Scenario: Issues render an expanded panel with badge

- **GIVEN** the health response contains stale, missing, or duplicate entries
- **WHEN** the user first opens the section in a browser session
- **THEN** the section header SHALL show `Issues (N)` with N equal to non-ok entry count
- **AND** the `PackageHealthPanel` SHALL render auto-expanded
- **AND** sub-sections SHALL render only for non-empty status groups

#### Scenario: Missing-path duplicate members are pre-checked for drop

- **GIVEN** a duplicate group of 4 members where 2 have `status === "missing-path"`
- **WHEN** the panel renders that group
- **THEN** those 2 members SHALL have their drop-checkbox pre-checked
- **AND** the other 2 SHALL be unchecked

#### Scenario: Apply triggers cleanup + refresh + restart banner

- **GIVEN** at least one row is checked for drop
- **WHEN** the user clicks Apply
- **THEN** the client SHALL issue exactly one `POST /api/packages/cleanup` with the union of checked sources
- **AND** on success SHALL re-fetch `/api/packages/installed`
- **AND** SHALL display a "Restart required" banner
- **AND** the Apply button SHALL be disabled while the request is in flight
