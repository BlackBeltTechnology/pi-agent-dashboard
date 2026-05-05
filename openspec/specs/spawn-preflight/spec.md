# spawn-preflight

## Purpose

Pure validation pass run by the spawn handler before invoking `spawnPiSession`. Accumulates every failing reason (no short-circuit) so the user sees all blockers at once, and uses a non-login-shell resolver to keep the spawn-click hot path fast.

## Requirements

### Requirement: Pure preflight validation function
The module `packages/server/src/spawn-preflight.ts` SHALL export `preflightSpawn(cwd: string, deps?: { resolver?: ToolResolver }): PreflightResult` where `PreflightResult = { ok: boolean; reasons: PreflightReason[] }` and `PreflightReason = { code: string; message: string }`. The function SHALL run all checks (no short-circuit) and accumulate every failing reason in `reasons`. `ok` SHALL be `true` if and only if `reasons.length === 0`.

The `ToolResolver` instance used by preflight (whether passed in `deps` or constructed by the handler) SHALL be configured with `useLoginShell: false` so preflight never spawns a login shell on the spawn-click hot path.

#### Scenario: cwd missing
- **WHEN** `preflightSpawn("/nonexistent")` is called
- **THEN** `result.ok` SHALL be `false`
- **AND** `result.reasons` SHALL contain an entry with `code: "DIR_MISSING"`

#### Scenario: cwd is a file not a directory
- **WHEN** `preflightSpawn(<path-to-regular-file>)` is called
- **THEN** `result.reasons` SHALL contain `code: "DIR_NOT_DIRECTORY"`

#### Scenario: cwd not writable
- **WHEN** `preflightSpawn(<read-only-dir>)` is called
- **THEN** `result.reasons` SHALL contain `code: "DIR_NOT_WRITABLE"`

#### Scenario: pi binary unresolvable
- **WHEN** `preflightSpawn(cwd, { resolver })` is called and `resolver.resolvePi()` returns `null`
- **THEN** `result.reasons` SHALL contain `code: "PI_NOT_FOUND"`

#### Scenario: node binary unresolvable
- **WHEN** `preflightSpawn(cwd, { resolver })` is called and `resolver.resolveNode()` returns `null`
- **THEN** `result.reasons` SHALL contain `code: "NODE_NOT_FOUND"`

#### Scenario: all checks pass
- **WHEN** `preflightSpawn(cwd, { resolver })` is called with a writable directory and resolvable pi+node
- **THEN** `result` SHALL equal `{ ok: true, reasons: [] }`

#### Scenario: multiple failures accumulate
- **WHEN** `preflightSpawn(<missing-dir>, { resolver })` is called and `resolver.resolvePi()` also returns `null`
- **THEN** `result.reasons` SHALL contain entries for both `DIR_MISSING` and `PI_NOT_FOUND` (not just the first)

### Requirement: Handler integrates preflight before spawn
`session-action-handler.handleSpawnSession` SHALL construct a preflight-only resolver as `new ToolResolver({ processExecPath: process.execPath, useLoginShell: false })` and call `preflightSpawn(msg.cwd, { resolver })` before invoking `spawnPiSession`. The actual `spawnPiSession` invocation SHALL continue to use the default resolver (with login-shell allowed). If `result.ok === false`, the handler SHALL emit `spawn_result { success: false, message: <reasons joined by "; "> }` and `spawn_error { code: "PREFLIGHT_FAILED", reasons }` and SHALL NOT call `spawnPiSession`.

#### Scenario: preflight resolver excludes login shell
- **WHEN** `handleSpawnSession` constructs the preflight resolver
- **THEN** the resolver's `useLoginShell` option SHALL be `false`
- **AND** preflight SHALL NOT spawn `$SHELL -ilc "which pi"` regardless of platform

#### Scenario: preflight refuses spawn
- **WHEN** `handleSpawnSession` runs preflight and receives `{ ok: false, reasons: [...] }`
- **THEN** `spawnPiSession` SHALL NOT be invoked
- **AND** a `spawn_error` message SHALL be sent with `code: "PREFLIGHT_FAILED"` and the full `reasons` array

#### Scenario: preflight passes
- **WHEN** `handleSpawnSession` runs preflight and receives `{ ok: true }`
- **THEN** `spawnPiSession` SHALL be invoked normally
