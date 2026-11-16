## MODIFIED Requirements

### Requirement: Orphan cleanup on server startup
On startup, the server SHALL read the headless PID file. Dead pids SHALL be removed. A live pid SHALL be verified by start time before it is killed or signalled: it matches when it started no later than its anchor plus 2 s. The anchor is `spawnedAt` for the spawn-time pid, `piLinkedAt` for a `piPid` that has one, and `spawnedAt` plus 60 s otherwise. Entries are reclaimed; one that fails verification is marked identity-refused, logged, and never signalled. An entry older than 7 days is killed only if it matches. Otherwise it gets no signal.

#### Scenario: Orphan process still alive
- **WHEN** the server starts and finds PID 12345 in the PID file and the process is still alive
- **THEN** the server SHALL add it to the headless registry for tracking

#### Scenario: Stale PID (process dead)
- **WHEN** the server starts and finds PID 12345 in the PID file but the process is not alive
- **THEN** the server SHALL remove the entry from the PID file

#### Scenario: Very old orphan killed
- **WHEN** the server starts and finds a PID spawned more than 7 days ago that is still alive and verifies as a match against its anchor
- **THEN** the server SHALL kill it (process group on Unix, direct on Windows) and remove the entry

#### Scenario: Recycled pid is reclaimed but never signalled
- **WHEN** the server starts and a persisted entry's live pid started more than 2 s after the entry's `spawnedAt`
- **THEN** the entry SHALL be marked identity-refused and the mismatch logged
- **AND** no later kill, reclaim or shutdown SHALL signal that pid

#### Scenario: Recycled very old pid is not killed
- **WHEN** a persisted entry older than 7 days has a live pid that fails verification
- **THEN** no signal SHALL be sent and the entry SHALL be removed

### Requirement: Headless PID persistence to disk
The server SHALL persist headless process entries to `~/.pi/dashboard/headless-pids.json` using atomic writes. The file SHALL contain an array of entries with fields `pid` (number), `cwd` (string), and `spawnedAt` (ISO timestamp). An entry may also carry `piLinkedAt` (ISO timestamp): when the pi PID was recorded, i.e. at `linkByToken` (pi was alive and registering) or the verified pi-PID sidecar's mtime. It is optional, and entries without it SHALL load. Entries SHALL be written on register and removed on process exit or kill.

#### Scenario: Headless process spawned
- **WHEN** a headless pi session is spawned with PID 12345 in `/projects/app`
- **THEN** the server SHALL write an entry `{ pid: 12345, cwd: "/projects/app", spawnedAt: "..." }` to the PID file

#### Scenario: Headless process exits
- **WHEN** a tracked headless process exits
- **THEN** the server SHALL remove its entry from the PID file

#### Scenario: PID file is empty
- **WHEN** no headless processes are tracked
- **THEN** the PID file SHALL contain `{ "entries": [] }`

#### Scenario: pi link time is persisted with the pi PID
- **WHEN** `linkByToken` records a pi PID from a live bridge's `session_register`
- **THEN** the persisted entry SHALL carry `piLinkedAt` equal to the time of that link, with no process probe

### Requirement: Headless spawn cleanup tracks keeper PIDs
The `headlessPidRegistry` SHALL track keeper PIDs alongside pi PIDs per session. The registry's existing `cleanupOrphans` pass SHALL be extended to:

1. Scan `~/.pi/dashboard/sessions/*.rpc.sock` (Unix) or named-pipe directory (Windows) for keepers.
2. For each keeper found: verify its PID is alive (via `isProcessAlive`) and its corresponding pi PID is alive.
3. Kill orphan keepers (alive keeper, dead pi) and unlink their socket + PID sidecar files, ONLY after verifying the keeper pid started no later than its pid sidecar's mtime plus 2 s. A keeper pid that fails or cannot complete this check SHALL NOT be signalled; it SHALL be logged and its sidecars left in place. A pi pid from the pi-PID sidecar SHALL be recorded, with `piLinkedAt` set to that sidecar's mtime, only when it started no later than that mtime plus 2 s.
4. Remove stale socket files where the keeper PID is dead.

The cleanup SHALL run on dashboard server startup BEFORE any new keepers are spawned.

#### Scenario: Cleanup removes orphan keeper after pi crash
- **GIVEN** a keeper for session `<sid>` is alive but its pi child has crashed
- **AND** the keeper pid started no later than its pid sidecar's mtime plus 2 s
- **WHEN** the dashboard server starts
- **THEN** the cleanup pass SHALL send SIGTERM to the keeper PID
- **AND** SHALL unlink `<sid>.rpc.sock` and `<sid>.rpc.sock.pid`
- **AND** the session SHALL not be registered as RPC-dispatch-ready

#### Scenario: Recycled keeper pid is not signalled
- **GIVEN** a keeper pid sidecar whose pid is alive but started more than 2 s after the sidecar's mtime
- **WHEN** the dashboard server starts
- **THEN** the cleanup pass SHALL NOT signal that pid
- **AND** SHALL log the identity mismatch

### Requirement: Process group kill for headless agents
When terminating a headless agent (via `killBySessionId`, `killAll`, or orphan cleanup), the server SHALL escalate from SIGTERM to SIGKILL if the pi process does not exit within a 2-second grace window. On Unix `killProcess` SHALL target the process group (`-pid`) whenever the killed pid leads its own group and that group is not the caller's own (otherwise, or when the caller's own group cannot be determined, it SHALL signal the pid alone — see `command-executor`); on Windows it SHALL use `taskkill /F /T /PID <pid>` (force, tree). A keeper-mediated pi is spawned by the keeper without `detached`, so it shares the KEEPER's process group (keeper + pi + pi's descendants) and is not a group leader itself. The escalation SHALL be implemented by delegating to the shared platform helper `killProcess(pid, { timeoutMs: 2000 })` in `packages/shared/src/platform/process.ts` — `killBySessionId` SHALL NOT issue raw `SIGTERM`-only kills against pi.

For keeper-mediated entries (those with `keeperPid !== undefined`), `killBySessionId` SHALL kill the pi process first using `killProcess(piPid, { timeoutMs: 2000 })`. After the pi kill, `killBySessionId` SHALL schedule a fire-and-forget `setTimeout` 200 ms later that calls `killProcessGroup(keeperPid, { timeoutMs: 2000 })`, terminating the keeper's whole process group. This SHALL be gated on the group still existing, NOT on keeper liveness: the keeper auto-exits with pi, but pi's orphaned descendants (a long `bash` tool call, an MCP server that ignores stdin EOF) remain in the keeper's group. `killProcessGroup` SHALL be a no-op when the group is already gone. The function SHALL be `async` and return `Promise<boolean>`; all call sites (`handleShutdown`, `handleForceKill`, `handleKillProcess`) SHALL `await` it.

For non-keeper entries (legacy path; kept for orphan cleanup of pre-`enable-rpc-keeper-by-default` sessions still on disk), `killBySessionId` SHALL also use `killProcess(pid, { timeoutMs: 2000 })` so the SIGTERM→SIGKILL ladder is uniform across both branches.

#### Scenario: Kill headless agent by session ID (Unix, cooperative pi)
- **WHEN** the server sends a shutdown command for a headless session on macOS or Linux AND the pi process exits within 2 seconds of receiving SIGTERM
- **THEN** the server SHALL call `killProcess(piPid, { timeoutMs: 2000 })`, which sends `SIGTERM` and resolves on pi-exit observed before the timeout
- **AND** no SIGKILL SHALL be sent

#### Scenario: Kill headless agent by session ID (Unix, hung pi)
- **WHEN** the server sends a shutdown command for a headless session on macOS or Linux AND the pi process does NOT exit within 2 seconds of SIGTERM
- **THEN** `killProcess` SHALL escalate to `SIGKILL`
- **AND** the 200 ms keeper-group timer SHALL still fire, calling `killProcessGroup(keeperPid, { timeoutMs: 2000 })`

#### Scenario: Kill headless agent by session ID (Windows, hung pi)
- **WHEN** the server sends a shutdown command for a headless session on Windows AND the pi process does NOT exit within 2 seconds of the initial kill attempt
- **THEN** `killProcess` SHALL invoke `taskkill /F /T /PID <piPid>` (force, tree) to terminate pi and any children

#### Scenario: Kill all headless agents on server stop
- **WHEN** the server calls `killAll()` during graceful shutdown
- **THEN** each tracked entry, except a restored entry refused by *A restored entry is verified before every signal*, SHALL be signalled with `SIGTERM` to its process group on Unix, or terminated directly on Windows, as today
- **AND** the calls MAY run in parallel via `Promise.all` since each `killProcess` is independent

#### Scenario: `killBySessionId` returns after pi has been confirmed dead or SIGKILLed
- **WHEN** `await headlessPidRegistry.killBySessionId(sessionId)` is called from a session-action handler
- **THEN** the returned promise SHALL resolve only after `killProcess`'s grace window has either observed pi exit or sent SIGKILL
- **AND** the resolved value SHALL be `true` when at least one kill (SIGTERM or SIGKILL) reached a previously-alive process and `false` when no entry existed for `sessionId`

#### Scenario: Orphaned pi children are reaped after the keeper exits
- **WHEN** a keeper-mediated headless session is killed, pi exits, and the keeper auto-exits before the 200 ms timer fires, while a child of pi that ignores `SIGTERM` is still alive in the keeper's process group
- **THEN** the timer SHALL still call `killProcessGroup(keeperPid, { timeoutMs: 2000 })`
- **AND** that child SHALL be terminated (`SIGTERM`, then `SIGKILL` after 2 seconds)

## ADDED Requirements

### Requirement: A restored entry is verified before every signal

Immediately before the first signal to a pid of a restored entry, the registry SHALL verify it against its anchor. A mismatch SHALL never be signalled; a mismatched `piPid` SHALL be cleared with `piLinkedAt`. The 200 ms keeper-group kill SHALL re-probe the keeper pid and skip on a mismatch. An unverifiable pid SHALL be signalled only on operator paths: shutdown, force-kill, and a `shutdown`, `user-quit` or `restart` stop. A null or absent exit intent is unattended.

#### Scenario: A pid recycled after restore is not signalled
- **WHEN** a restored entry's pid exits after the restore and is reused by an unrelated process, and the entry is later killed
- **THEN** the registry SHALL NOT signal the reused pid

#### Scenario: Unverifiable identity on an unattended path
- **WHEN** an unattended reclaim reaches a restored entry on a host where the start time cannot be determined
- **THEN** no signal SHALL be sent and the reclaim SHALL be reported as failed, stating the identity was unverifiable

#### Scenario: An idle auto-stop does not signal an unverifiable restored entry
- **WHEN** the server stops with exit intent `idle`, `signal` or `ephemeral` and a restored entry's start time cannot be determined
- **THEN** `killAll` SHALL NOT signal that entry

#### Scenario: A token reclaim is unattended
- **WHEN** a reclaim by spawn token reaches a restored entry whose start time cannot be determined
- **THEN** no signal SHALL be sent

#### Scenario: Operator force-kill of an unverifiable restored entry
- **WHEN** an operator force-kills a session whose restored entry's start time cannot be determined
- **THEN** the registry SHALL signal it as before, and log that the identity was unverifiable

#### Scenario: Residual race inside the kill ladder
- **WHEN** a verified pid exits and is recycled within the SIGTERM-to-SIGKILL ladder
- **THEN** the escalation MAY reach the recycled pid; this residual is accepted and SHALL NOT be claimed as covered

#### Scenario: A null or absent exit intent is unattended
- **WHEN** `killAll` runs with a null or absent exit intent and a restored entry's start time cannot be determined
- **THEN** `killAll` SHALL NOT signal that entry

#### Scenario: An operator path refused for a proven mismatch reports it
- **WHEN** an operator shutdown or force-kill reaches a restored entry whose pid fails verification as a mismatch
- **THEN** no signal SHALL be sent and `killBySessionId` SHALL return `false`
- **AND** force-kill SHALL return `force_kill_result` with `success: false` and a message naming the identity reuse

#### Scenario: The keeper-group timer skips a recycled keeper pid
- **WHEN** the 200 ms keeper-group timer fires and the keeper pid now fails verification as a mismatch
- **THEN** `killProcessGroup` SHALL NOT be called for it

#### Scenario: The keeper-group timer still reaps after the keeper exited
- **WHEN** the 200 ms keeper-group timer fires and the keeper pid is gone
- **THEN** `killProcessGroup(keeperPid, { timeoutMs: 2000 })` SHALL still be called

#### Scenario: The keeper-group timer follows the operator rule when unverifiable
- **WHEN** the 200 ms keeper-group timer fires and the keeper pid's start time cannot be determined
- **THEN** the group kill SHALL fire on an operator path and SHALL NOT fire on an unattended path

#### Scenario: A refused keeper pid is never group-signalled
- **WHEN** a restored entry's keeper pid is marked identity-refused and its `piPid` verifies as a match
- **THEN** the `piPid` SHALL be signalled and no process group SHALL be signalled for the keeper pid

#### Scenario: A pid-only link skips an identity-refused entry
- **WHEN** `linkByPid` is called with the pid of an identity-refused entry
- **THEN** that entry SHALL NOT gain a `sessionId`, `piPid` or `piLinkedAt`

#### Scenario: An undeterminable anchor is unverifiable
- **WHEN** a restored pid's anchor is missing, not a valid timestamp, or its sidecar mtime cannot be read
- **THEN** its verdict SHALL be unverifiable
- **AND** a `piLinkedAt` later than now SHALL be treated as now

#### Scenario: A slow or failing probe never blocks shutdown
- **WHEN** a start-time probe takes longer than 2 s, or rejects
- **THEN** that pid's verdict SHALL be unverifiable
- **AND** `killAll` SHALL settle within a 5 s total verification budget without rejecting
