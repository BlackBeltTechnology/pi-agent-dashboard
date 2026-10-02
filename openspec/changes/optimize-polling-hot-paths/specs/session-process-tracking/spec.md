## MODIFIED Requirements

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
