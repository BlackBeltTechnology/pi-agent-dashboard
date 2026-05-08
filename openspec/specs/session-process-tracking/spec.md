## Purpose

[Spec purpose]
## Requirements
### Requirement: Process scanner detects child processes of pi session
The `process-scanner` module SHALL export a `scanChildProcesses(parentPid: number)` function that returns an array of `ChildProcessInfo` objects. Each object SHALL contain `pid` (number), `pgid` (number), `command` (string, the full args from `ps`), and `elapsedMs` (number, milliseconds since process start).

The scanner SHALL use a two-phase approach with PGID tracking:

**Phase 1 (Capture):** Use `ps -eo pid=,ppid=` to find direct child PIDs of the pi process (pgrep is not used because it misses detached children on macOS). Recurse one level to find grandchildren. Capture their PGIDs into a tracked set via `ps -p {pids} -o pgid=`.

**Phase 2 (Check):** Use `ps -eo pid=,pgid=,etime=,args=` to find all processes belonging to tracked PGIDs. Remove dead PGIDs from the tracked set. Filter out bash/sh wrappers (show leaf commands only).

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

### Requirement: Process scanner filters by minimum elapsed time
The `scanChildProcesses` function SHALL accept an optional `minElapsedMs` parameter (default: 30000). Processes with `elapsedMs` less than `minElapsedMs` SHALL be excluded from the returned array.

#### Scenario: Short-lived process filtered out
- **WHEN** a child process has been running for 5 seconds and `minElapsedMs` is 30000
- **THEN** it SHALL NOT appear in the returned array

#### Scenario: Long-running process included
- **WHEN** a child process has been running for 2 minutes and `minElapsedMs` is 30000
- **THEN** it SHALL appear in the returned array

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
On `process.platform === "win32"`, `scanChildProcesses` SHALL return an empty array without executing any shell commands.

#### Scenario: Windows platform
- **WHEN** `scanChildProcesses` is called on Windows
- **THEN** it SHALL return an empty array immediately

#### Scenario: macOS platform
- **WHEN** `scanChildProcesses` is called on macOS (`darwin`)
- **THEN** it SHALL execute `pgrep` and `ps` and return results

#### Scenario: Linux platform
- **WHEN** `scanChildProcesses` is called on Linux
- **THEN** it SHALL execute `pgrep` and `ps` and return results

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
The bridge extension SHALL start a periodic timer (10 second interval) that calls `scanChildProcesses(process.pid)`. It SHALL compare the result to the previous scan. If the list has changed (different PIDs), it SHALL send a `process_list` message to the server.

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

### Requirement: Session card shows active child processes
The dashboard session card SHALL display a process list section when the session has active child processes (non-empty process list). Each entry SHALL show a truncated command string (max 40 characters), elapsed time (human-readable), and a red ✕ button.

#### Scenario: No active processes
- **WHEN** a session has no child processes
- **THEN** the process list section SHALL NOT be rendered

#### Scenario: Active processes displayed
- **WHEN** a session has two child processes
- **THEN** the card SHALL show two entries with command, elapsed time, and kill buttons

#### Scenario: Kill button sends kill request immediately
- **WHEN** the user clicks the ✕ button for a process
- **THEN** the browser SHALL send a `kill_process` message with the session ID and PGID immediately without confirmation

#### Scenario: Process disappears after kill
- **WHEN** a kill request succeeds and the next process scan excludes the killed process
- **THEN** the entry SHALL be removed from the session card

### Requirement: ProcessList removed from session card
The ProcessList component SHALL NOT render inside SessionCard. Process information SHALL remain available via `session.processes` data and SHALL be accessible in SessionSidebar/detail view.

#### Scenario: No process list in card
- **WHEN** a session has active child processes
- **THEN** ProcessList SHALL NOT render inside the SessionCard

