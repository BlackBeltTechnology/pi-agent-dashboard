# stuck-session-escalation Specification (delta)

## ADDED Requirements

### Requirement: Force kill terminates the full process tree on POSIX
On POSIX platforms, `handleForceKill` SHALL terminate the pi process AND every descendant process, including detached children in their own process groups. A shared helper `killProcessTree(pid)` SHALL snapshot descendants via `ps -eo pid,ppid,pgid` (BFS from the root pid), signal each unique descendant process group with SIGTERM, wait up to 2 s, SIGKILL survivors, and finally apply the existing single-PID SIGTERM→SIGKILL to the root pid. The server's own process group SHALL never be signalled. Windows SHALL keep the existing `taskkill /F /T` path.

#### Scenario: Detached bash child dies with pi
- **GIVEN** a pi session whose bash tool spawned a detached child in its own process group
- **WHEN** the user triggers `force_kill`
- **THEN** both the pi process and the detached child process SHALL be terminated

#### Scenario: Server process group never targeted
- **WHEN** the descendant snapshot contains a pgid equal to the dashboard server's own process group
- **THEN** that group SHALL be excluded from signalling

#### Scenario: Windows path unchanged
- **WHEN** `force_kill` runs on win32
- **THEN** termination SHALL use `taskkill /F /T /PID <pid>` as before

### Requirement: PID-reuse guard before tree kill
Before signalling, the handler SHALL re-read the root pid's command line and require an `isPiCommandLine` match. On mismatch the kill SHALL be aborted and reported as failed with a pid-reuse reason; no signal SHALL be sent.

#### Scenario: Recycled PID is not killed
- **GIVEN** `session.pid` now belongs to an unrelated process
- **WHEN** `force_kill` is triggered
- **THEN** no signal SHALL be sent
- **AND** `force_kill_result { success: false }` SHALL be returned with a pid-reuse message

### Requirement: No-PID force kill falls back to marker search
When `session.pid` is undefined, the handler SHALL attempt `findPidByMarker(sessionId)` to locate the pi process before giving up. If found, the tree kill proceeds on that pid. If not found, the handler SHALL close the bridge WebSocket, SHALL NOT stamp the session `ended`, and SHALL send `force_kill_result { success: false }` stating the process may still be running.

#### Scenario: Marker search recovers missing pid
- **GIVEN** a session registered without a pid whose pi process command line contains the session marker
- **WHEN** `force_kill` is triggered
- **THEN** the process located by marker SHALL be tree-killed

#### Scenario: Honest failure when process not found
- **GIVEN** a session without a pid and no marker match
- **WHEN** `force_kill` is triggered
- **THEN** the response SHALL be `force_kill_result { success: false }`
- **AND** the session status SHALL NOT be set to `ended` by the handler

### Requirement: Death verified before status change
The handler SHALL verify the root process is dead (poll `isProcessAlive`, up to 3 s) before setting `status: "ended"`. If the process survives, status SHALL remain unchanged and `force_kill_result { success: false }` SHALL be sent.

#### Scenario: Ended stamped only after verified death
- **WHEN** the tree kill completes and `isProcessAlive(pid)` returns false
- **THEN** the session status SHALL be set to `ended` and broadcast

#### Scenario: Survivor reported, status untouched
- **WHEN** the process is still alive after the kill sequence and verification window
- **THEN** the session status SHALL NOT change
- **AND** `force_kill_result { success: false, message }` SHALL be sent

### Requirement: Force-kill attempts are logged
Every `force_kill` attempt SHALL emit one structured server-log line containing session id, pid (or `none`), outcome (`killed` | `tree_killed` | `not_found` | `pid_reused` | `survived`), and elapsed milliseconds.

#### Scenario: Log line per attempt
- **WHEN** any `force_kill` message is handled
- **THEN** exactly one structured log line with sessionId, pid, outcome, and duration SHALL be written

### Requirement: Client surfaces force-kill failure
The client SHALL consume `force_kill_result`. On `success: false` it SHALL show an error toast with the result message and reset the composer stop state from "Killing..." back to the Force Stop state so the user can retry. On `success: true` no additional UI action is required.

#### Scenario: Failure toast and button revert
- **GIVEN** the composer is in the "Killing..." state
- **WHEN** `force_kill_result { success: false, message }` arrives for the selected session
- **THEN** an error toast containing the message SHALL be shown
- **AND** the composer SHALL return to the Force Stop state

#### Scenario: Success needs no extra handling
- **WHEN** `force_kill_result { success: true }` arrives
- **THEN** no toast SHALL be shown (the subsequent `session_updated` → ended drives the UI)

### Requirement: Stall banner for silent streaming sessions
When a session's status is `streaming` and no activity has been recorded for at least 120 s (derived from `lastActivityAt`), the session banner SHALL display an advisory stall line ("no activity — session may be stuck") offering the existing Stop and Force Stop actions. The line SHALL disappear as soon as new activity arrives or the session leaves `streaming`.

#### Scenario: Stall line appears after silence
- **GIVEN** a session with status `streaming`
- **WHEN** 120 s pass with no activity event
- **THEN** the banner SHALL show the stall advisory with escalation actions

#### Scenario: Stall line clears on activity
- **GIVEN** the stall advisory is visible
- **WHEN** a new activity event arrives for the session
- **THEN** the stall advisory SHALL be removed

#### Scenario: No stall line while healthy
- **WHEN** activity events arrive within the threshold
- **THEN** no stall advisory SHALL be shown

### Requirement: Bridge abort watchdog kills hung tool children
When a user abort has been latched and the agent is still streaming `WATCHDOG_DELAY_MS` (10 s) later, the bridge SHALL scan its child process groups and terminate them (SIGTERM, then SIGKILL after 2 s for survivors), so the hung tool errors out and pi's cooperative abort completes. The watchdog SHALL: fire at most once per latched abort; disarm on `agent_end`, on a new user prompt, and on latch clear; do nothing when the scan finds no children; and use per-PID tree kill on win32.

#### Scenario: Hung bash child killed after latched abort
- **GIVEN** the user pressed Stop (abort latched) and a bash tool child is still running 10 s later with the agent still streaming
- **THEN** the bridge SHALL terminate the child's process group
- **AND** the agent turn SHALL settle via pi's abort path

#### Scenario: Watchdog disarms on agent_end
- **GIVEN** the watchdog timer is armed
- **WHEN** `agent_end` arrives before the timer fires
- **THEN** no child process SHALL be signalled

#### Scenario: One shot per latch
- **GIVEN** the watchdog already fired for the current latched abort
- **WHEN** the agent continues streaming
- **THEN** the watchdog SHALL NOT fire again until a new abort is latched

#### Scenario: No children, no action
- **WHEN** the watchdog fires and the child scan returns zero processes
- **THEN** no signal SHALL be sent
