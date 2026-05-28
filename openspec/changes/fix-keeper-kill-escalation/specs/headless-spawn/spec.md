## MODIFIED Requirements

### Requirement: Process group kill for headless agents
When terminating a headless agent (via `killBySessionId`, `killAll`, or orphan cleanup), the server SHALL escalate from SIGTERM to SIGKILL if the pi process does not exit within a 2-second grace window. On Unix the escalation SHALL target the entire process group via `process.kill(-pid, "SIGKILL")`; on Windows it SHALL use `taskkill /F /T /PID <pid>` (force, tree). The escalation SHALL be implemented by delegating to the shared platform helper `killProcess(pid, { timeoutMs: 2000 })` in `packages/shared/src/platform/process.ts` — `killBySessionId` SHALL NOT issue raw `SIGTERM`-only kills against pi.

For keeper-mediated entries (those with `keeperPid !== undefined`), `killBySessionId` SHALL kill the pi process first using `killProcess(piPid, { timeoutMs: 2000 })`. After scheduling the pi kill, `killBySessionId` SHALL schedule a fire-and-forget `setTimeout` 200 ms later that sends `SIGTERM` to the keeper PID; the keeper's own SIGTERM handler is reliable and does not require SIGKILL escalation at the registry layer. The function SHALL be `async` and return `Promise<boolean>`; all call sites (`handleShutdown`, `handleForceKill`, `handleKillProcess`) SHALL `await` it.

For non-keeper entries (legacy path; kept for orphan cleanup of pre-`enable-rpc-keeper-by-default` sessions still on disk), `killBySessionId` SHALL also use `killProcess(pid, { timeoutMs: 2000 })` so the SIGTERM→SIGKILL ladder is uniform across both branches.

#### Scenario: Kill headless agent by session ID (Unix, cooperative pi)
- **WHEN** the server sends a shutdown command for a headless session on macOS or Linux AND the pi process exits within 2 seconds of receiving SIGTERM
- **THEN** the server SHALL call `killProcess(piPid, { timeoutMs: 2000 })` which sends `process.kill(-pid, "SIGTERM")` and resolves on pi-exit observed before the timeout
- **AND** no SIGKILL SHALL be sent

#### Scenario: Kill headless agent by session ID (Unix, hung pi)
- **WHEN** the server sends a shutdown command for a headless session on macOS or Linux AND the pi process does NOT exit within 2 seconds of SIGTERM
- **THEN** `killProcess` SHALL escalate to `process.kill(-pid, "SIGKILL")` on the pi process group
- **AND** the keeper-fallback SIGTERM 200 ms timer SHALL still fire as today, sending SIGTERM to the keeper PID

#### Scenario: Kill headless agent by session ID (Windows, hung pi)
- **WHEN** the server sends a shutdown command for a headless session on Windows AND the pi process does NOT exit within 2 seconds of the initial kill attempt
- **THEN** `killProcess` SHALL invoke `taskkill /F /T /PID <piPid>` (force, tree) to terminate pi and any children

#### Scenario: Kill all headless agents on server stop
- **WHEN** the server calls `killAll()` during graceful shutdown
- **THEN** each tracked entry SHALL be killed via `killProcess(pid, { timeoutMs: 2000 })` (SIGTERM→2s→SIGKILL ladder) on Unix or `taskkill /F /T /PID` on Windows
- **AND** the calls MAY run in parallel via `Promise.all` since each `killProcess` is independent

#### Scenario: `killBySessionId` returns after pi has been confirmed dead or SIGKILLed
- **WHEN** `await headlessPidRegistry.killBySessionId(sessionId)` is called from a session-action handler
- **THEN** the returned promise SHALL resolve only after `killProcess`'s grace window has either observed pi exit or sent SIGKILL
- **AND** the resolved value SHALL be `true` when at least one kill (SIGTERM or SIGKILL) reached a previously-alive process and `false` when no entry existed for `sessionId`
