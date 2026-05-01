## ADDED Requirements

### Requirement: Post-install transition invalidates the entire ToolRegistry

On every `bootstrapState` transition from `"installing"` to `"ready"`, the server SHALL invalidate every cached `Resolution` in the shared `ToolRegistry` (equivalent to calling `registry.rescan()` with no argument). The invalidation SHALL run before any subsequent code path consumes a `ToolRegistry` resolution.

The previous narrower implementation that only invalidated the `pi` Resolution is replaced by this requirement, restoring the literal contract from `unified-bootstrap-install` task 4.3 ("registry rescan").

#### Scenario: Full rescan on installing → ready transition

- **WHEN** the bootstrap state transitions from `"installing"` to `"ready"` (regardless of caller — `runDegradedModeBootstrap`, `triggerUpgradePi`, or `triggerRetry`)
- **THEN** every cached `Resolution` in the `ToolRegistry` SHALL be invalidated
- **AND** the next call to `registry.resolve(<name>)` for any registered tool SHALL re-run that tool's strategy chain against the post-install filesystem state

#### Scenario: openspec resolves after first-run install

- **WHEN** the dashboard server starts on a machine with no `openspec` on PATH and no `~/.pi-dashboard/` install
- **AND** the degraded-mode bootstrap install completes successfully
- **THEN** `registry.resolve("openspec")` SHALL return `{ ok: true }` immediately after the `installing → ready` transition
- **AND** `platform/runner.ts::resolveExecutorArgv("openspec", [...])` SHALL return a non-null argv on the next call

#### Scenario: Rescan does not run on other transitions

- **WHEN** the bootstrap state transitions to `"failed"` (no successful install)
- **OR** the bootstrap state remains `"ready"` (no transition)
- **THEN** the server SHALL NOT invalidate `ToolRegistry` cache entries

#### Scenario: User overrides survive rescan

- **WHEN** the user has set a tool override via `POST /api/tools/:name` (writing `~/.pi/dashboard/tool-overrides.json`)
- **AND** the bootstrap state transitions from `"installing"` to `"ready"`
- **THEN** the override file on disk SHALL remain unchanged
- **AND** the next `registry.resolve(<name>)` SHALL re-read the override and continue to honor it

### Requirement: Centralized post-install repair work

The rescan-on-transition behavior SHALL be implemented in exactly one site (the server's `bootstrapState.subscribe` callback). All bootstrap-install callers (degraded-mode CLI bootstrap, REST `triggerUpgradePi`, REST `triggerRetry`) SHALL rely on the centralized hook rather than performing local rescans.

#### Scenario: All three install entry points trigger the same rescan

- **WHEN** any of `runDegradedModeBootstrap`, `triggerUpgradePi`, or `triggerRetry` complete successfully and flip state to `"ready"`
- **THEN** the centralized subscribe callback SHALL fire exactly once per transition
- **AND** the `ToolRegistry` SHALL be rescanned exactly once per transition

#### Scenario: Local rescan in cli.ts is removed

- **WHEN** inspecting `packages/server/src/cli.ts` after this change
- **THEN** the file SHALL NOT contain a direct call to `registry.rescan(...)`
- **AND** SHALL contain a comment citing the centralized subscribe-hook owner of post-install rescan
