## ADDED Requirements

### Requirement: Global toast for off-screen spawn errors
The client SHALL surface every `spawn_error` whose `cwd` is not represented in the current view via the existing app-level `Toast` channel, in addition to the existing per-folder `spawnErrors` banner. A cwd is considered "represented in the current view" when ANY of the following holds: (a) it matches an entry in `pinnedDirectories`, (b) it matches a `folders[]` entry of any workspace, (c) at least one session in `sessions` has the same cwd. When none hold, the error has no folder banner to render in and SHALL produce a toast.

#### Scenario: Spawn into pinned dir keeps existing banner only
- **WHEN** `spawn_error` arrives with `cwd: "/Users/dev/proj-A"` and `/Users/dev/proj-A` is in `pinnedDirectories`
- **THEN** `spawnErrors` SHALL be updated as today
- **AND** NO toast SHALL be enqueued

#### Scenario: Spawn into workspace folder keeps existing banner only
- **WHEN** `spawn_error` arrives with `cwd: "/Users/dev/proj-B"` and `/Users/dev/proj-B` appears in some `workspace.folders`
- **THEN** `spawnErrors` SHALL be updated as today
- **AND** NO toast SHALL be enqueued

#### Scenario: Spawn into cwd of an existing session keeps existing banner only
- **WHEN** `spawn_error` arrives with `cwd: "/Users/dev/proj-C"` and at least one session in `sessions` has `cwd: "/Users/dev/proj-C"`
- **THEN** `spawnErrors` SHALL be updated as today
- **AND** NO toast SHALL be enqueued

#### Scenario: Spawn into off-screen cwd produces toast
- **WHEN** `spawn_error` arrives with `cwd: "/Users/dev/proj-X"`, `/Users/dev/proj-X` is NOT pinned, NOT in any workspace folders, AND no session has that cwd
- **THEN** `spawnErrors` SHALL still be updated (for late-pin / future-render correctness)
- **AND** a toast SHALL be enqueued with `kind: "error"`, message containing both the cwd and the spawn-error code/reason summary, and `durationMs >= 10_000`

#### Scenario: Toast message format
- **WHEN** a toast is enqueued for `spawn_error { cwd: "/Users/dev/x", code: "REGISTER_TIMEOUT", message: "Pi session spawned but never registered (timeout 30000ms)" }`
- **THEN** the toast message SHALL include the substring `REGISTER_TIMEOUT`
- **AND** SHALL include the cwd `/Users/dev/x`
- **AND** SHALL include a truncated form of the message (≤ 200 chars)

#### Scenario: Toast suppressed when banner already on screen
- **WHEN** `spawn_error` arrives for a cwd that has a visible folder banner AND a previous toast for the same `requestId` is already showing
- **THEN** the existing toast SHALL be dismissed
- **AND** the banner SHALL render the error as the canonical surface

### Requirement: Cwd-visibility check is path-key aware
The visibility check SHALL compare cwds using the existing `pathKey(path, platform)` helper from `session-grouping.ts`, so cosmetic drift (trailing slash, separator style, macOS/Windows case-insensitivity) does NOT cause spurious toasts when a folder banner is in fact on screen under a slightly different spelling.

#### Scenario: Trailing-slash drift does not trigger toast
- **WHEN** `pinnedDirectories` contains `/repo/` and `spawn_error.cwd` is `/repo`
- **THEN** the cwd SHALL be considered visible (banner exists)
- **AND** NO toast SHALL fire

#### Scenario: Windows case drift does not trigger toast
- **WHEN** platform is `win32`, a session exists at cwd `C:\Repo` and `spawn_error.cwd` is `c:\repo`
- **THEN** the cwd SHALL be considered visible
- **AND** NO toast SHALL fire
