## MODIFIED Requirements

### Requirement: Single-source process-termination module
All code in `packages/server/src`, `packages/extension/src`, `packages/electron/src`, and `packages/shared/src` (excluding `packages/shared/src/platform/process.ts` and `packages/shared/src/platform/exec.ts`) SHALL terminate processes exclusively via helpers exported from `@blackbelt-technology/pi-dashboard-shared/platform/process.js` (`isProcessAlive`, `killProcess`, `killPidWithGroup`, `killProcessGroup`, `probeProcessStart`, `verifyAndKillWindows`, `wslLiveness`, `verifyAndKillWsl`). Direct calls to `process.kill(pid, …)` outside the platform module are prohibited, as is spawning `powershell.exe` or `wsl.exe` with a process probe or signal command. A repo-level test SHALL enforce this invariant, with an explicit path allowlist.

#### Scenario: No direct process.kill outside the platform module
- **WHEN** the test suite scans every `.ts` file under `packages/*/src/` (excluding `__tests__/` and `packages/shared/src/platform/`)
- **THEN** no file SHALL contain a call matching the regex `\bprocess\.kill\s*\(`
- **AND** any match SHALL cause the test to fail with the offending file paths and line numbers

#### Scenario: Adding a new termination site
- **WHEN** a developer needs to terminate a PID, check liveness, or kill a process group
- **THEN** they SHALL import the appropriate helper (`isProcessAlive`, `killProcess`, `killPidWithGroup`, or `killProcessGroup`) from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`
- **AND** the enforcement test SHALL pass without modification

#### Scenario: Platform module is exempt
- **WHEN** the scanner encounters files under `packages/shared/src/platform/`
- **THEN** those files SHALL be skipped
- **AND** their internal use of `process.kill` SHALL NOT cause failures

#### Scenario: No PowerShell or wsl.exe process control outside the platform module
- **WHEN** the enforcement test scans `packages/*/src/` outside `packages/shared/src/platform/`
- **THEN** no file SHALL spawn `powershell.exe` or `wsl.exe` with a process probe or signal command
- **AND** a probe or signal command means `Get-Process`, `StartTime`, `taskkill`, `Stop-Process`, or `kill` run through `wsl.exe`
- **AND** a new file containing one of them SHALL fail the test naming its path and line

#### Scenario: The process-control allowlist is explicit and exact
- **WHEN** the enforcement test runs against the current tree
- **THEN** it SHALL pass with exactly three allowlisted files: `packages/extension/src/process-scanner.ts` (process enumeration), `packages/browser-plugin/src/server/dedicated/process-identity.ts`, and the tmux spawn in `packages/server/src/spawn-process/process-manager.ts`
- **AND** `__tests__/` files SHALL be skipped
- **AND** an allowlist entry whose file no longer exists SHALL fail the test

### Requirement: Cross-platform tree termination uses killProcess
Code that needs to terminate a spawned session, editor, tunnel, or any process whose descendants MUST also be terminated SHALL use `killProcess(pid, opts)` from the platform module. Exception: an identity-verified termination on a Windows server SHALL use `verifyAndKillWindows` (host) or `verifyAndKillWsl` (WSL), which check and kill in one invocation. On Windows this SHALL invoke `taskkill /F /T /PID <pid>`; on POSIX, when `pid` leads its own process group and that group is not the caller's own group, `killProcess` SHALL delegate to `killProcessGroup(pid, opts)` so the process's descendants in that group are terminated with it (parity with the Windows tree kill); otherwise it SHALL send SIGTERM to `pid`, wait up to `timeoutMs` (default 5000), then SIGKILL if the process is still alive. Group leadership SHALL be detected by an errno-aware signal-0 probe of `-pid` (ESRCH ⇒ not a leader). The caller's own process group SHALL be read once via `ps -o pgid= -p <ownPid>` and cached; when it cannot be determined, `killProcess` SHALL fall back to the single-pid ladder so it never signals the caller's own group.

Code that spawned a process as the leader of its own process group (detached on POSIX) and must also terminate descendants that were not reparented away from that group SHALL use `killProcessGroup(pid, opts)` from the platform module. On POSIX it SHALL send SIGTERM to the group (`-pid`), poll every 200ms until no member of the group is alive or `timeoutMs` (default 5000) elapses, re-check that the group still exists before escalating, and then send SIGKILL to the group. On Windows it SHALL delegate to `killProcess(pid, opts)` (`taskkill /F /T`).

#### Scenario: Windows tree kill
- **WHEN** `killProcess(pid)` is invoked with `platform: "win32"`
- **THEN** the platform SHALL execute `taskkill /F /T /PID <pid>` via the wrapped `execSync`
- **AND** return `{ ok: true, forced: false }` on success

#### Scenario: POSIX escalation path
- **WHEN** `killProcess(pid, { timeoutMs: 2000 })` is invoked with `platform: "linux"` or `platform: "darwin"` on a live PID that does not lead its own process group
- **THEN** the platform SHALL send `SIGTERM` to `pid`
- **AND** poll liveness every 200ms until `timeoutMs` elapses
- **AND** send `SIGKILL` if the process is still alive when the deadline passes
- **AND** return `{ ok: true, forced: true }` when SIGKILL was required

#### Scenario: Already-dead process
- **WHEN** `killProcess(pid)` is invoked for a PID that is not alive
- **THEN** the platform SHALL return `{ ok: false, forced: false }` without sending any signal

#### Scenario: POSIX group escalation reaches workers
- **WHEN** `killProcessGroup(pid, { timeoutMs: 2000 })` is invoked on a group leader whose worker child ignores SIGTERM
- **THEN** the platform SHALL send `SIGTERM` to `-pid`, wait up to `timeoutMs`, and send `SIGKILL` to `-pid`
- **AND** no member of the group SHALL be alive afterwards
- **AND** return `{ ok: true, forced: true }`

#### Scenario: Group already gone before escalation
- **WHEN** every member of the group exits during the SIGTERM wait
- **THEN** no SIGKILL SHALL be sent

#### Scenario: Windows group kill delegates
- **WHEN** `killProcessGroup(pid)` is invoked with `platform: "win32"`
- **THEN** it SHALL behave exactly as `killProcess(pid)`

#### Scenario: POSIX group leader is killed with its group
- **WHEN** `killProcess(pid, { timeoutMs: 2000 })` is invoked on POSIX for a live PID that leads its own process group, and that group is not the caller's
- **THEN** the platform SHALL send `SIGTERM` to `-pid`, and `SIGKILL` to `-pid` if a member is still alive after `timeoutMs`
- **AND** a child of `pid` that ignores `SIGTERM` SHALL NOT be alive afterwards

#### Scenario: Never signal the caller's own group
- **WHEN** `killProcess(pid)` is invoked on POSIX and `pid` equals the caller's own process-group id, or the caller's own process-group id cannot be determined
- **THEN** the platform SHALL signal `pid` only (single-pid ladder) and SHALL NOT signal `-pid`

#### Scenario: A verified Windows reclaim does not use killProcess
- **WHEN** an unattended reclaim verifies and terminates a host pid on a Windows server
- **THEN** it SHALL use `verifyAndKillWindows`, not a probe followed by `killProcess`

## ADDED Requirements

### Requirement: Process start time is probed through the platform module

The platform module SHALL expose `probeProcessStart(pid, target, { timeoutMs = 10_000 })` returning epoch ms or `null`, where `target` is `{ kind: "host" }` or `{ kind: "wsl", distro }`. A Windows host target SHALL use `Get-Process` via absolute-path Windows PowerShell. A POSIX host target SHALL use `processStartedAt`. A WSL target SHALL use the process age inside the distribution. Invalid input SHALL yield `null`.

#### Scenario: Windows creation time is returned in epoch milliseconds
- **WHEN** the probe runs on Windows for a live host pid
- **THEN** it SHALL return that process's creation time in epoch milliseconds

#### Scenario: A WSL start time is skew-immune
- **WHEN** the WSL clock is ahead of or behind the Windows clock
- **THEN** the probed start SHALL equal the server's current time minus the process age measured inside the distribution

#### Scenario: A dead pid, invalid input, or timeout yields null
- **WHEN** the pid does not exist, the pid or distro fails validation, or the probe times out
- **THEN** the probe SHALL return `null`

#### Scenario: Only the normalised target shape is accepted
- **WHEN** the probe is called with a bare string such as `"host"` instead of `{ kind: "host" }`
- **THEN** it SHALL return `null` and spawn nothing

### Requirement: A WSL-target pid is verified and terminated inside its distribution

The platform module SHALL expose `verifyAndKillWsl(pid, distro, { minAgeMs?, timeoutMs })`. In one `sh -c` invocation inside the distribution it SHALL check that the process age is at least `minAgeMs`, when given. It SHALL then send `SIGTERM`, to `-pid` when the pid leads its process group and to `pid` otherwise, and `SIGKILL` the same way after `timeoutMs`. It SHALL NOT invoke `taskkill`. `wslLiveness` SHALL return `alive`, `absent` (only on the script's explicit marker) or `unknown`.

#### Scenario: WSL termination stays inside the distribution
- **WHEN** `verifyAndKillWsl` runs for pid `P` in distribution `D`
- **THEN** every signal SHALL be delivered inside `D` and `taskkill` SHALL NOT be invoked

#### Scenario: A process-group leader is killed with its group
- **WHEN** `P` leads its own process group inside `D`
- **THEN** the signals SHALL target `-P`

#### Scenario: The in-shell residual race is documented
- **WHEN** a verified WSL pid exits and is reused between the in-script check and `kill` inside the one shell
- **THEN** the signal MAY reach the reused pid; this residual SHALL be documented and SHALL NOT be claimed as covered

#### Scenario: A failed wsl.exe call is not absence
- **WHEN** `wsl.exe` fails or times out
- **THEN** `wslLiveness` SHALL return `unknown`

#### Scenario: The age check is skew-immune
- **WHEN** `minAgeMs` is given and the process age inside the distribution is below it
- **THEN** the result SHALL be `mismatch` and no signal SHALL be sent
- **AND** the bound SHALL be an age, not an absolute time, so WSL and Windows clock skew cannot change the outcome

#### Scenario: The group leader is read without ps
- **WHEN** the script decides between a group and a single-pid signal
- **THEN** it SHALL read the pgid from `/proc/<pid>/stat`, parsed after the last `)`, and SHALL NOT run `ps`
- **AND** an unreadable stat file SHALL give `error` and no signal

#### Scenario: Absence needs the marker, whatever the locale
- **WHEN** the distribution runs under a non-English locale or a shell that words "No such process" differently
- **THEN** the script SHALL force `LC_ALL=C` and print the explicit marker
- **AND** `wslLiveness` SHALL return `absent` only when that marker is printed, and `unknown` for any other output

### Requirement: A Windows host pid is verified and killed in one invocation

The platform module SHALL expose `verifyAndKillWindows(pid, { maxStartMs, timeoutMs })`. It SHALL check the creation time and run `taskkill /F /T /PID` in the same PowerShell process, and SHALL report `killed`, `mismatch` or `absent`. The residual race is the gap inside that one process; it SHALL be documented, not claimed as covered.

#### Scenario: A pid recycled after the probe is not killed
- **WHEN** the process at `pid` started later than `maxStartMs`
- **THEN** no process SHALL be killed and the result SHALL be `mismatch`

#### Scenario: The handle is pinned before the check
- **WHEN** `verifyAndKillWindows` runs
- **THEN** the script SHALL open the process handle before comparing the creation time, and run `taskkill` while it is still open
- **AND** the CI leg SHALL show 0 reuse of the target pid across 500 spawns while the handle is held

### Requirement: Process helper invocations are bounded and validated

The four process helpers SHALL share one limiter of at most 2 `powershell.exe` or `wsl.exe` invocations in flight per server. `timeoutMs` SHALL start at slot acquisition. A verify-and-kill invocation SHALL time out at `timeoutMs + 10 s` and yield `error`. A result SHALL be accepted only when the trimmed stdout equals exactly one marker; anything else SHALL be `error`. Invalid input SHALL spawn nothing.

#### Scenario: Probes, kills and liveness share the two slots
- **WHEN** probes, verify-and-kill calls and liveness calls are issued concurrently
- **THEN** at most 2 invocations SHALL be in flight in total, started in FIFO order

#### Scenario: Queue wait does not consume the timeout
- **WHEN** a call waits in the queue behind two wedged invocations
- **THEN** its own `timeoutMs` SHALL start only when it acquires a slot

#### Scenario: A wrapper timeout is an error
- **WHEN** a verify-and-kill call with `timeoutMs` 2000 does not return
- **THEN** it SHALL still be pending at 11 999 ms of execution and SHALL yield `error` at 12 000 ms

#### Scenario: Noisy or unknown output is an error
- **WHEN** stdout is empty, carries banner text, has a second token, or differs in case from `killed`, `mismatch` or `absent`
- **THEN** the result SHALL be `error`
- **AND** surrounding whitespace alone SHALL be tolerated

#### Scenario: Invalid input spawns nothing
- **WHEN** the pid is not a positive integer, the distro fails `^[A-Za-z0-9._-]{1,64}$`, `maxStartMs` or `minAgeMs` is negative or not finite, the platform is not win32 for a Windows or WSL target, or `SystemRoot` is missing or relative
- **THEN** the probe SHALL return `null`, a verify-and-kill call SHALL return `error`, and `wslLiveness` SHALL return `unknown`
- **AND** no process SHALL be spawned
