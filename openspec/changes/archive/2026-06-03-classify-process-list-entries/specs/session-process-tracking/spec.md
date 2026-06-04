## ADDED Requirements

### Requirement: Bridge excludes pi's own process group from the process list
The bridge SHALL resolve pi's own process-group id (PGID) once at session start and add it to the `excludedPgids` set passed to `scanChildProcesses`. Because pi's plugin/MCP sidecars (e.g. context-mode's `server.bundle.mjs`) are spawned directly by pi and inherit pi's PGID, excluding pi's own PGID SHALL prevent pi itself and all same-process-group plumbing from being captured into `trackedPgids` or surfaced in the `process_list`.

Resolution SHALL use a single cached lookup (`ps -o pgid= -p <process.pid>` on Unix). On platforms where the scan path is PID-based (Windows), this exclusion MAY be a no-op.

User-spawned background tasks and subagent processes that run in their own PGID (detached by the bash tool) SHALL remain visible — only processes sharing pi's own PGID are excluded.

#### Scenario: Same-group plugin sidecar hidden
- **WHEN** pi has a direct child whose PGID equals pi's own PGID (e.g. the context-mode bun sidecar)
- **THEN** that process SHALL NOT appear in the `process_list`
- **AND** pi's own PGID SHALL NOT be added to `trackedPgids`

#### Scenario: pi-self hidden
- **WHEN** the process scan would otherwise report the pi process itself (because its PGID was tracked)
- **THEN** the pi process SHALL NOT appear in the `process_list`

#### Scenario: Detached user task remains visible
- **WHEN** a bash-tool command runs in its own detached PGID different from pi's PGID
- **THEN** that process SHALL still appear in the `process_list`

#### Scenario: Subagent in its own group remains visible
- **WHEN** a nested `pi` process runs in a PGID different from pi's own PGID
- **THEN** that process SHALL still appear in the `process_list`

### Requirement: Process list renders type icon and friendly label
The client `ProcessList` SHALL render each process row using the server-supplied `kind` (icon) and `label` (text) instead of the raw `command` string when those fields are present. Rows with `kind: "sub-session"` SHALL be linkable to the referenced session (`sessionRef`) — clicking the row focuses that session's card. When `kind`/`label` are absent (older bridge/server), the row SHALL fall back to rendering the raw `command` as today.

#### Scenario: Sub-session row shows session name and links
- **WHEN** a row has `kind: "sub-session"`, `label: "build worker"`, `sessionRef: "abc123"`
- **THEN** the row SHALL display the sub-session icon and the text `build worker`
- **AND** activating the row SHALL focus the session card whose id is `abc123`

#### Scenario: Plugin row shows plugin name
- **WHEN** a row has `kind: "plugin"`, `label: "context-mode"`
- **THEN** the row SHALL display the plugin icon and the text `context-mode`

#### Scenario: Task row shows command
- **WHEN** a row has `kind: "task"`, `label: "vitest --watch"`
- **THEN** the row SHALL display the task icon and the text `vitest --watch`

#### Scenario: Backward-compatible fallback
- **WHEN** a row has no `kind` or `label` field
- **THEN** the row SHALL render the raw `command` string and the existing kill affordance, unchanged
