# session-process-tracking Specification

## Purpose
Track and surface child processes spawned by pi sessions. The bridge extension scans its own child processes (and grandchildren via leaf-only filtering), tags PGIDs, filters out short-lived noise and self-spawned dashboard infrastructure, and forwards a stable change-driven `process_list` to the dashboard. The session card renders the list with a stable row floor and overflow tail so the card footer height does not bounce as processes appear and disappear.

## Requirements

### Requirement: Process scanner detects child processes of pi session
The `process-scanner` module SHALL export a `scanChildProcesses(parentPid: number, trackedPgids: Set<number>, minElapsedMs?: number, options?: ScanOptions)` function that returns an array of `ChildProcessInfo` objects, and an async counterpart `scanChildProcessesAsync` with the same arguments and result. Each object SHALL contain `pid` (number), `pgid` (number), `command` (string, the full args from `ps`), and `elapsedMs` (number, milliseconds since process start).

On Unix the scanner SHALL take exactly ONE process-table snapshot per scan with `ps -A -o pid=,ppid=,pgid=,etime=,args=` and SHALL derive both phases from that snapshot in memory. It SHALL NOT spawn `ps` once per child and SHALL NOT use `pgrep`. A snapshot row SHALL be parsed as four leading fields plus the remainder as args; empty args SHALL be allowed, so no row (and no parent→child edge) is dropped because of its args.

**Phase 1 (Capture):** From the snapshot, find direct child PIDs of the pi process and one level of their children (grandchildren). Capture their PGIDs (read from the same snapshot rows) into the tracked set. PGIDs present in the optional `excludedPgids` set (passed via `ScanOptions`) SHALL NOT be added to `trackedPgids`.

**Phase 2 (Check):** From the same snapshot, find all processes belonging to tracked PGIDs. Remove dead PGIDs from the tracked set. Additionally, remove dead PIDs from the `excludedPgids` set when present. Filter out bash/sh wrappers (show leaf commands only). Filter out entries whose PGID is in `excludedPgids` (defense-in-depth in case a self-spawned PID raced into `trackedPgids` before registration).

The `trackedPgids` parameter is a `Set<number>` maintained across scans. The `command` field SHALL contain the `ps` args output (actual running binary), including embedded spaces.

#### Scenario: No children
- **WHEN** `scanChildProcesses` is called and the pi session has no child processes
- **THEN** it SHALL return an empty array

#### Scenario: Active children found
- **WHEN** `scanChildProcesses` is called and the pi session has two child processes
- **THEN** it SHALL return an array of two `ChildProcessInfo` objects with correct pid, pgid, command, and elapsedMs

#### Scenario: Grandchildren found
- **WHEN** `scanChildProcesses` is called and a direct child (bash) has spawned a grandchild (node/vitest)
- **THEN** the grandchild SHALL also appear in the returned array

#### Scenario: Leaf-only filtering
- **WHEN** a direct child (bash wrapper) has one or more grandchildren
- **THEN** the bash wrapper SHALL be excluded from the result and only the grandchildren (leaf processes) SHALL be returned

#### Scenario: Childless direct child included
- **WHEN** a direct child has no children of its own (it IS a leaf)
- **THEN** it SHALL be included in the result

#### Scenario: One snapshot per scan regardless of child count
- **WHEN** a scan runs while the pi process has five direct children
- **THEN** the scanner SHALL spawn `ps` exactly once for that scan

#### Scenario: Command with spaces parsed intact
- **WHEN** a snapshot row's args are `node /a b/c.js --flag x`
- **THEN** the returned `command` SHALL be `node /a b/c.js --flag x`

#### Scenario: Row with empty args keeps the tree
- **WHEN** a snapshot contains a direct child row whose args are empty (e.g. a zombie) and that child has a grandchild
- **THEN** the grandchild SHALL be found through that child and the leaf-only rule SHALL apply as for any other child

#### Scenario: ps fails or not available
- **WHEN** `ps` returns an error or is not available
- **THEN** `scanChildProcesses` SHALL return an empty array (no throw) and `trackedPgids` SHALL be left unchanged

#### Scenario: Excluded PGID refused at capture
- **WHEN** the capture phase discovers a child PGID that is present in `excludedPgids`
- **THEN** that PGID SHALL NOT be added to `trackedPgids`

#### Scenario: Excluded PGID filtered at scan
- **WHEN** the check phase encounters an alive process whose PGID is present in `excludedPgids`
- **THEN** that process SHALL NOT appear in the returned array, even if its PGID is in `trackedPgids`

#### Scenario: Dead excluded PGID reaped
- **WHEN** a scan runs and a PGID in `excludedPgids` has no live process in the snapshot
- **THEN** that PGID SHALL be removed from `excludedPgids`

### Requirement: Process scanner filters by minimum elapsed time
The `scanChildProcesses` function SHALL accept an optional `minElapsedMs` parameter. Processes with `elapsedMs` less than `minElapsedMs` SHALL be excluded from the returned array. The default value of `minElapsedMs` SHALL be 30000 (preserving safe behavior for callers that do not pass an override). Callers SHOULD pass platform-appropriate values: 5000 on Unix (macOS, Linux) and 30000 on Windows.

#### Scenario: Short-lived process filtered out
- **WHEN** a child process has been running for 3 seconds and `minElapsedMs` is 5000
- **THEN** it SHALL NOT appear in the returned array

#### Scenario: Long-running process included
- **WHEN** a child process has been running for 30 seconds and `minElapsedMs` is 5000
- **THEN** it SHALL appear in the returned array

#### Scenario: Default min elapsed when omitted
- **WHEN** `scanChildProcesses` is called without `minElapsedMs`
- **THEN** the effective minimum SHALL be 30000

### Requirement: Process scanner parses ps ETIME format
The scanner SHALL correctly parse the `ps` ETIME column format into milliseconds. Supported formats: `mm:ss`, `hh:mm:ss`, `dd-hh:mm:ss`.

#### Scenario: Parse mm:ss format
- **WHEN** ETIME is `02:15`
- **THEN** elapsedMs SHALL be 135000

#### Scenario: Parse hh:mm:ss format
- **WHEN** ETIME is `01:30:00`
- **THEN** elapsedMs SHALL be 5400000

#### Scenario: Parse dd-hh:mm:ss format
- **WHEN** ETIME is `2-03:00:00`
- **THEN** elapsedMs SHALL be 183600000

### Requirement: Process scanner is Unix-only with platform guard
On `process.platform === "win32"`, `scanChildProcesses` SHALL NOT execute `ps`; it SHALL delegate to the Windows scanner defined by `session-process-tracker`.

#### Scenario: Windows platform
- **WHEN** `scanChildProcesses` is called on Windows
- **THEN** it SHALL NOT spawn `ps` and SHALL return the Windows scanner's result

#### Scenario: macOS platform
- **WHEN** `scanChildProcesses` is called on macOS (`darwin`)
- **THEN** it SHALL take one `ps` snapshot and return results

#### Scenario: Linux platform
- **WHEN** `scanChildProcesses` is called on Linux
- **THEN** it SHALL take one `ps` snapshot and return results

### Requirement: Kill child process by PGID
The `process-scanner` module SHALL export a `killProcessByPgid(pgid: number)` function that calls `process.kill(-pgid, "SIGTERM")`. It SHALL return `true` if the signal was sent successfully, `false` if the process was already dead (ESRCH).

#### Scenario: Process killed successfully
- **WHEN** `killProcessByPgid` is called with a valid PGID
- **THEN** it SHALL send SIGTERM to the process group and return `true`

#### Scenario: Process already dead
- **WHEN** `killProcessByPgid` is called with a PGID that no longer exists
- **THEN** it SHALL catch the ESRCH error and return `false`

#### Scenario: Windows no-op
- **WHEN** `killProcessByPgid` is called on Windows
- **THEN** it SHALL return `false` without calling `process.kill`

### Requirement: Bridge polls process scanner and sends updates on change
The bridge extension SHALL periodically call the async scanner with `(process.pid, trackedPgids, minElapsedMs, { excludedPgids })`. It SHALL compare the result to the previous scan. If the list has changed (different PIDs), it SHALL send a `process_list` message to the server.

The scan SHALL NOT block pi's event loop (async process spawn). At most one scan SHALL be in flight; a scan that falls due while another is pending SHALL be skipped, not queued.

The cadence SHALL be adaptive and platform-aware:

- **Fast** — while the agent is running (between `agent_start` and `agent_end`), while any tool execution is in flight, within 15 s after the later of the last `agent_end` and the last `tool_execution_end`, or within 30 s after the scanned list last changed: every 5000 ms on macOS/Linux, every 10000 ms on Windows.
- **Idle** — otherwise: every 30000 ms on macOS/Linux, every 60000 ms on Windows.

`minElapsedMs` SHALL be 5000 on macOS/Linux and 30000 on Windows. When an event moves the scheduler from idle to fast (`agent_start`, `tool_execution_start`) and the next scheduled scan is further away than the fast interval, the bridge SHALL re-arm it to run within the fast interval. When a tool execution named `bash` (compared case-insensitively) ends, the bridge SHALL run one additional scan 1000 ms later. Creating the scan schedule SHALL first dispose any existing one, so a new, forked or resumed session leaves exactly one.

The bridge SHALL maintain a `selfSpawnedPgids: Set<number>` on `BridgeContext`, passed as `excludedPgids` to the scanner on every scan. The bridge SHALL register a PID into `selfSpawnedPgids` immediately after spawning each of its own auto-started subprocesses, prior to awaiting any readiness signal. Registered subprocesses SHALL include, at minimum:

- The dashboard server child spawned by the bridge's auto-start path.
- Any RPC keeper sidecar spawned by the bridge.

#### Scenario: Process list changed
- **WHEN** a scan detects a new child process not in the previous list
- **THEN** the bridge SHALL send a `process_list` message with the full current list

#### Scenario: Process list unchanged
- **WHEN** a scan returns the same PIDs as the previous scan
- **THEN** the bridge SHALL NOT send a `process_list` message

#### Scenario: Process list becomes empty
- **WHEN** a scan returns no processes and the previous scan had processes
- **THEN** the bridge SHALL send a `process_list` message with an empty array

#### Scenario: Timer cleanup on disconnect
- **WHEN** the bridge reloads or the session ends (`session_shutdown`)
- **THEN** the process-scan schedule SHALL be disposed, SHALL NOT re-arm, and a scan resolving afterwards SHALL NOT send

#### Scenario: Tick cadence on Unix
- **WHEN** the bridge runs on macOS or Linux and a tool execution is in flight
- **THEN** scans SHALL run every 5000 ms and pass `minElapsedMs = 5000`

#### Scenario: Leaving idle re-arms promptly
- **WHEN** the scheduler is idle with the next scan 25 s away and a tool execution starts
- **THEN** a scan SHALL run within 5000 ms of the tool start (10000 ms on Windows)

#### Scenario: Idle cadence on Unix
- **WHEN** the bridge runs on macOS or Linux, the agent and tools have been idle for 15 s, and the list has not changed for 30 s
- **THEN** scans SHALL run every 30000 ms

#### Scenario: Tick cadence on Windows
- **WHEN** the bridge runs on Windows
- **THEN** fast scans SHALL run every 10000 ms, idle scans every 60000 ms, and each SHALL pass `minElapsedMs = 30000`

#### Scenario: Post-bash scan
- **WHEN** a `bash` tool execution ends
- **THEN** the bridge SHALL run one scan 1000 ms later regardless of the regular cadence

#### Scenario: Overlapping scan skipped
- **WHEN** a scan falls due while the previous scan's process spawn has not resolved
- **THEN** no second spawn SHALL start for that due time

#### Scenario: Self-spawned dashboard server registered
- **WHEN** the bridge auto-starts the dashboard server and `spawn` returns a child with a valid PID
- **THEN** the bridge SHALL add that PID to `selfSpawnedPgids` before awaiting health-readiness

#### Scenario: Self-spawned dashboard server not surfaced
- **GIVEN** the bridge auto-started a dashboard server whose PID is in `selfSpawnedPgids`
- **WHEN** the next process scan runs
- **THEN** that dashboard server process SHALL NOT appear in the emitted `process_list`

#### Scenario: Self-spawned RPC keeper registered
- **WHEN** the bridge spawns an RPC keeper sidecar
- **THEN** the bridge SHALL add the keeper's PID to `selfSpawnedPgids` before any further use

### Requirement: Client renders the PGID scan as a collapsible drawer
The client-side background-process list SHALL contribute its inventory to the PROCESS subcard's single collapsible summary line instead of rendering its own separate `⚠ N background processes` summary row. When collapsed, background processes SHALL be represented by a background-count segment in the unified line; their individual killable rows SHALL appear in the expanded body below the in-flight bash rows. The per-row `✕` PGID-kill verb and the overflow tail SHALL be unchanged.

#### Scenario: Collapsed line shows the background-count segment
- **GIVEN** one background process and no in-flight bash tools
- **WHEN** the summary line renders collapsed
- **THEN** it SHALL show a background indicator with count `⚠ 1`
- **AND** it SHALL NOT render a separate standalone drawer summary row

#### Scenario: Expanded body lists killable background rows
- **GIVEN** the collapsed summary line with background processes present
- **WHEN** the user expands the line
- **THEN** each background process SHALL render a row with its command and a `✕` control
- **AND** activating `✕` SHALL invoke `killProcess(pgid)` (unchanged)

#### Scenario: Bash and background counts coexist in one line
- **GIVEN** two in-flight bash tools and one background process
- **WHEN** the summary line renders collapsed
- **THEN** it SHALL show both a `2 running` segment and a `⚠ 1` segment in the single line

### Requirement: Drawer per-row ✕ continues to invoke PGID kill
The per-row ✕ button in the drawer SHALL continue to call `onKill(pgid)` (SIGTERM→SIGKILL via the existing `force_kill` path). It SHALL NOT be confused with the activity bar's stop verb.

#### Scenario: Drawer kill click hits the PGID path
- **GIVEN** an expanded drawer with a process row for `pgid=48213`
- **WHEN** the user clicks the ✕ on that row
- **THEN** the component SHALL invoke `onKill(48213)`

#### Scenario: Drawer kill tooltip
- **GIVEN** an expanded drawer row
- **WHEN** the user hovers the ✕ button
- **THEN** the tooltip SHALL indicate force-kill of the process tree (literal copy: `"Force-kill process tree"`)

### Requirement: Skeleton row padding removed
The drawer SHALL NOT pad its rendered output with invisible skeleton rows. Previous `MIN_SLOTS=5` padding is removed; the activity bar above provides the card's stable visual surface.

#### Scenario: One process renders one row
- **GIVEN** the drawer receives 1 process and `expanded === true`
- **WHEN** it renders
- **THEN** it SHALL render the summary row plus exactly 1 process row
- **AND** it SHALL NOT render any aria-hidden skeleton rows

### Requirement: Overflow tail preserved
Excess processes beyond `MAX_VISIBLE=5` SHALL continue to collapse into a single `+N more processes` row with a tooltip listing the hidden command lines. This behaviour is preserved from today.

#### Scenario: Seven processes render with overflow
- **GIVEN** the drawer receives 7 processes and `expanded === true`
- **WHEN** it renders
- **THEN** it SHALL render the summary row plus 5 process rows plus 1 `+2 more processes` overflow row
- **AND** the overflow row SHALL expose the hidden commands via its `title` attribute

### Requirement: Drawer default state is collapsed and persists per session server-side
The background-processes drawer's initial expansion state SHALL be derived from a per-session stored boolean, NOT from the activity bar context. When the session has no stored choice, the drawer SHALL render collapsed. A user toggle SHALL persist to `<session>.meta.json#processDrawerCollapsed`, SHALL be broadcast on the session object so every connected client reflects it, and SHALL be honored on reload. The stored value SHALL be pruned automatically when the session is deleted (its meta file is removed).

This supersedes the prior contextual default (`expanded === true` when the activity bar is empty and the drawer is non-empty).

#### Scenario: No stored choice renders collapsed
- **GIVEN** a session with 2 background processes and no `processDrawerCollapsed` value in its meta
- **WHEN** the PROCESS subcard renders
- **THEN** the drawer SHALL render collapsed (`expanded === false`)
- **AND** the `⚠ 2 background processes` summary row SHALL still be visible

#### Scenario: Stored expanded choice is honored on load
- **GIVEN** a session whose meta has `processDrawerCollapsed === false`
- **WHEN** the PROCESS subcard renders
- **THEN** the drawer SHALL render expanded

#### Scenario: User toggle persists server-side
- **GIVEN** a collapsed drawer for session `S`
- **WHEN** the user clicks the summary row to expand it
- **THEN** the client SHALL send `set_session_process_drawer { sessionId: "S", collapsed: false }`
- **AND** the server SHALL write `processDrawerCollapsed: false` to `S`'s meta and rebroadcast the session

#### Scenario: Choice survives reload and syncs across clients
- **GIVEN** the user has expanded the drawer for session `S` on client A
- **WHEN** client A reloads, or client B is already connected
- **THEN** both clients SHALL render the drawer for `S` expanded

#### Scenario: Stored value pruned on session delete
- **GIVEN** a session `S` with a stored `processDrawerCollapsed` value
- **WHEN** session `S` is deleted and its `.meta.json` removed
- **THEN** no orphan `processDrawerCollapsed` value SHALL persist for `S`

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
