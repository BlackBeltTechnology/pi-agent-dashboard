## MODIFIED Requirements

### Requirement: Process scanner detects child processes of pi session
The `process-scanner` module SHALL export a `scanChildProcesses(parentPid: number, trackedPgids: Set<number>, minElapsedMs?: number, options?: ScanOptions)` function that returns an array of `ChildProcessInfo` objects. Each object SHALL contain `pid` (number), `pgid` (number), `command` (string, the full args from `ps`), and `elapsedMs` (number, milliseconds since process start).

The scanner SHALL use a two-phase approach with PGID tracking:

**Phase 1 (Capture):** Use `ps -eo pid=,ppid=` to find direct child PIDs of the pi process (pgrep is not used because it misses detached children on macOS). Recurse one level to find grandchildren. Capture their PGIDs into a tracked set via `ps -p {pids} -o pgid=`. PGIDs present in the optional `excludedPgids` set (passed via `ScanOptions`) SHALL NOT be added to `trackedPgids`.

**Phase 2 (Check):** Use `ps -eo pid=,pgid=,etime=,args=` to find all processes belonging to tracked PGIDs. Remove dead PGIDs from the tracked set. Additionally, remove dead PIDs from the `excludedPgids` set when present. Filter out bash/sh wrappers (show leaf commands only). Filter out entries whose PGID is in `excludedPgids` (defense-in-depth in case a self-spawned PID raced into `trackedPgids` before registration).

The `scanChildProcesses(parentPid, trackedPgids, minElapsedMs?, options?)` function combines both phases. The `trackedPgids` parameter is a `Set<number>` maintained across scans. The `command` field SHALL contain the `ps` args output (actual running binary).

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

#### Scenario: ps fails or not available
- **WHEN** `ps` returns an error or is not available
- **THEN** `scanChildProcesses` SHALL return an empty array (no throw)

#### Scenario: Excluded PGID refused at capture
- **WHEN** `captureChildPgids` discovers a child PGID that is present in `excludedPgids`
- **THEN** that PGID SHALL NOT be added to `trackedPgids`

#### Scenario: Excluded PGID filtered at scan
- **WHEN** `scanTrackedProcesses` encounters an alive process whose PGID is present in `excludedPgids`
- **THEN** that process SHALL NOT appear in the returned array, even if its PGID is in `trackedPgids`

#### Scenario: Dead excluded PGID reaped
- **WHEN** `scanTrackedProcesses` runs and a PGID in `excludedPgids` has no live process
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

### Requirement: Bridge polls process scanner and sends updates on change
The bridge extension SHALL start a periodic timer that calls `scanChildProcesses(process.pid, trackedPgids, minElapsedMs, { excludedPgids })`. It SHALL compare the result to the previous scan. If the list has changed (different PIDs), it SHALL send a `process_list` message to the server.

The timer interval and `minElapsedMs` SHALL be platform-aware:

- On `process.platform !== "win32"` (macOS, Linux): timer interval 5000 ms, `minElapsedMs` 5000.
- On `process.platform === "win32"`: timer interval 10000 ms, `minElapsedMs` 30000.

The bridge SHALL maintain a `selfSpawnedPgids: Set<number>` on `BridgeContext`, passed as `excludedPgids` to the scanner on every tick. The bridge SHALL register a PID into `selfSpawnedPgids` immediately after spawning each of its own auto-started subprocesses, prior to awaiting any readiness signal. Registered subprocesses SHALL include, at minimum:

- The dashboard server child spawned by the bridge's auto-start path.
- Any RPC keeper sidecar spawned by the bridge.

#### Scenario: Process list changed
- **WHEN** the periodic scan detects a new child process not in the previous list
- **THEN** the bridge SHALL send a `process_list` message with the full current list

#### Scenario: Process list unchanged
- **WHEN** the periodic scan returns the same PIDs as the previous scan
- **THEN** the bridge SHALL NOT send a `process_list` message

#### Scenario: Process list becomes empty
- **WHEN** the periodic scan returns no processes and the previous scan had processes
- **THEN** the bridge SHALL send a `process_list` message with an empty array

#### Scenario: Timer cleanup on disconnect
- **WHEN** the bridge disconnects or the session ends
- **THEN** the process scan timer SHALL be cleared

#### Scenario: Tick cadence on Unix
- **WHEN** the bridge runs on macOS or Linux
- **THEN** the process scan timer SHALL fire every 5000 ms and pass `minElapsedMs = 5000`

#### Scenario: Tick cadence on Windows
- **WHEN** the bridge runs on Windows
- **THEN** the process scan timer SHALL fire every 10000 ms and pass `minElapsedMs = 30000`

#### Scenario: Self-spawned dashboard server registered
- **WHEN** the bridge auto-starts the dashboard server and `spawn` returns a child with a valid PID
- **THEN** the bridge SHALL add that PID to `selfSpawnedPgids` before awaiting health-readiness

#### Scenario: Self-spawned dashboard server not surfaced
- **GIVEN** the bridge auto-started a dashboard server whose PID is in `selfSpawnedPgids`
- **WHEN** the next process scan tick runs
- **THEN** that dashboard server process SHALL NOT appear in the emitted `process_list`

#### Scenario: Self-spawned RPC keeper registered
- **WHEN** the bridge spawns an RPC keeper sidecar
- **THEN** the bridge SHALL add the keeper's PID to `selfSpawnedPgids` before any further use

### Requirement: Session card shows active child processes
The dashboard session card SHALL display a process list section when the session has active child processes (non-empty process list). Each visible entry SHALL show a truncated command string (max 40 characters in full layout, 30 in compact), elapsed time (human-readable), and a kill button.

When `processes.length > 0`, the rendered list SHALL enforce a **minimum of 5 row slots** and a **maximum of 5 visible process rows**:

- If `processes.length < 5`: render all process rows followed by skeleton rows to pad the total to 5. Skeleton rows SHALL match the height and chrome of a real row but contain no text, no icon, and no kill button. Skeleton rows SHALL have `aria-hidden="true"`.
- If `processes.length === 5`: render all 5 process rows and no skeleton or overflow rows.
- If `processes.length > 5`: render the 5 process rows with the largest `elapsedMs` (longest-running first), followed by a single overflow tail row reading `+{N} more processes` where `N = processes.length - 5`. The overflow row SHALL expose the hidden command lines via a `title` attribute. The overflow row SHALL NOT have a kill button.

Process rows visible to the user SHALL be ordered by `elapsedMs` descending. This ordering applies to both the `compact` (mobile) and full layouts.

When `processes.length === 0`, the process list section SHALL NOT render (returning `null`).

#### Scenario: No active processes
- **WHEN** a session has no child processes
- **THEN** the process list section SHALL NOT be rendered

#### Scenario: Single process pads to floor
- **WHEN** a session has 1 child process
- **THEN** the card SHALL render 1 entry with command, elapsed time, and kill button, followed by 4 skeleton rows

#### Scenario: Three processes pad to floor
- **WHEN** a session has 3 child processes
- **THEN** the card SHALL render 3 entries followed by 2 skeleton rows

#### Scenario: Exactly five processes
- **WHEN** a session has exactly 5 child processes
- **THEN** the card SHALL render 5 entries with no skeleton rows and no overflow row

#### Scenario: Six processes show overflow tail
- **WHEN** a session has 6 child processes
- **THEN** the card SHALL render 5 entries (longest-running) followed by 1 overflow row reading "+1 more processes"

#### Scenario: Eight processes show overflow tail
- **WHEN** a session has 8 child processes
- **THEN** the card SHALL render 5 entries (longest-running) followed by 1 overflow row reading "+3 more processes"

#### Scenario: Overflow tail tooltip lists hidden commands
- **WHEN** an overflow row is rendered for hidden processes
- **THEN** the overflow row's `title` attribute SHALL contain the command lines of the hidden processes

#### Scenario: Visible rows sorted by elapsed time descending
- **WHEN** a session has 3 child processes with elapsedMs 60000, 10000, 120000
- **THEN** the rendered order SHALL be 120000, 60000, 10000

#### Scenario: Skeleton row has no kill button
- **WHEN** a skeleton row is rendered to fill the slot floor
- **THEN** the row SHALL contain no kill button, no command text, and SHALL be marked `aria-hidden`

#### Scenario: Kill button sends kill request immediately
- **WHEN** the user clicks the kill button for a process
- **THEN** the browser SHALL send a `kill_process` message with the session ID and PGID immediately without confirmation

#### Scenario: Process disappears after kill
- **WHEN** a kill request succeeds and the next process scan excludes the killed process
- **THEN** the entry SHALL be removed from the session card
