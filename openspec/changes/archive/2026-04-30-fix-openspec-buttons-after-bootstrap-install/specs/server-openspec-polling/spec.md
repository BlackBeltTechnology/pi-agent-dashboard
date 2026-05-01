## ADDED Requirements

### Requirement: Force-refresh OpenSpec data on bootstrap install completion

On every `bootstrapState` transition from `"installing"` to `"ready"`, the server SHALL force-refresh OpenSpec data (bypassing the mtime change-detection gate) for every directory returned by `directoryService.knownDirectories()`. For each directory whose refreshed `OpenSpecData` differs from the cached value (or whose cached value was empty / `{ initialized: false, changes: [] }`), the server SHALL broadcast an `openspec_update` message with `cwd` and `data` fields to all connected browsers.

This requirement closes the gap where, on a fresh first-run install, the `openspec` CLI Resolution is cached as `not-found` at boot, every initial poll yields empty data, and the cached empty data persists in the `DirCache` after the install succeeds. Without this requirement, OpenSpec session-card buttons remain hidden until the user manually triggers a refresh or up to one full poll interval elapses (and even then the gate may decline to re-poll if no file mtime advanced).

#### Scenario: Empty caches populate after first-run install

- **WHEN** the dashboard server starts on a machine with no `openspec` available
- **AND** every known directory's cached `OpenSpecData` is `{ initialized: false, changes: [] }`
- **AND** the degraded-mode bootstrap install completes successfully
- **THEN** the server SHALL force-refresh OpenSpec for every known directory
- **AND** broadcast `openspec_update` for each directory whose refreshed data is non-empty
- **AND** session-card buttons (`P/D/T/S` letters, attach combo, refresh) SHALL render in the connected browser within ~1 second of the `installing → ready` transition

#### Scenario: Force-refresh bypasses the mtime gate

- **WHEN** the `installing → ready` transition fires
- **AND** `DashboardConfig.openspec.changeDetection` is `"mtime"` (default)
- **THEN** every per-cwd refresh SHALL run the underlying `pollOne(cwd, /*force=*/true)` path
- **AND** the mtime cache SHALL be ignored for this single refresh
- **AND** subsequent periodic ticks SHALL resume gated polling unchanged

#### Scenario: Force-refresh respects the concurrency cap

- **WHEN** the `installing → ready` transition fires for a workspace with N known directories and M total changes across them
- **THEN** concurrent `openspec list` / `openspec status` CLI invocations SHALL NOT exceed `DashboardConfig.openspec.maxConcurrentSpawns` (default 4)
- **AND** the work SHALL complete asynchronously without blocking the bootstrap-state subscribe callback

#### Scenario: No force-refresh on failed install

- **WHEN** the bootstrap state transitions to `"failed"`
- **THEN** the server SHALL NOT force-refresh OpenSpec for any directory
- **AND** SHALL NOT emit any `openspec_update` broadcasts caused by this transition

#### Scenario: No force-refresh on no-op transitions

- **WHEN** the bootstrap state remains `"ready"` (e.g. periodic state echo, `lastBootstrapStatus === snapshot.status`)
- **THEN** the server SHALL NOT force-refresh OpenSpec
- **AND** SHALL NOT emit `openspec_update` broadcasts caused by this transition

#### Scenario: Refresh failure for one directory does not block others

- **WHEN** force-refresh succeeds for cwd A but throws for cwd B
- **THEN** the broadcast for cwd A SHALL still be emitted
- **AND** the failure for cwd B SHALL be logged at error level
- **AND** SHALL NOT propagate to other transitions or callers

### Requirement: Force-refresh pi-resources on bootstrap install completion

On every `bootstrapState` transition from `"installing"` to `"ready"`, the server SHALL also force-refresh the pi-resources scan (`directoryService.refreshPiResources(cwd)`) for every directory returned by `directoryService.knownDirectories()`. This closes the equivalent gap for pi-skill / pi-extension / pi-prompt discovery, which would otherwise wait up to 5× the openspec poll interval (default 150 s) before reflecting newly-installed packages.

#### Scenario: Pi-resources cache repopulates after install

- **WHEN** the bootstrap install completes and the post-install hook fires
- **THEN** for every known directory, `directoryService.refreshPiResources(cwd)` SHALL be invoked
- **AND** the refreshed data SHALL be cached so the next `GET /api/pi-resources?cwd=…` returns the fresh result without an extra delay
