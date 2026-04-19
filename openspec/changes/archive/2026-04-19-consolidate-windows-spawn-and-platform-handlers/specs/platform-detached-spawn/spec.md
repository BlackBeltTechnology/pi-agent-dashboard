## ADDED Requirements

### Requirement: Detached spawn primitive with uniform defaults
The `packages/shared/src/platform/detached-spawn.ts` module SHALL export a `spawnDetached(opts)` function that spawns a child process with uniform, OS-correct defaults on every platform. The function SHALL accept `{ cmd, args, cwd?, env?, logFd?, platform? }` where `platform` defaults to `process.platform` and is overridable for tests. The function SHALL always pass `detached: true` to Node's `spawn()`, SHALL always pass `windowsHide: true`, SHALL always pass `shell: false`, and SHALL always pass `stdio` with `stdio[0] = "ignore"`, `stdio[1] = "ignore"`, and `stdio[2] = logFd` when `logFd` is provided or `"ignore"` when it is not. The function SHALL call `child.unref()` on the returned ChildProcess before returning. The function SHALL NOT accept a `shell` option, a `pipe` stdio value, or any option that would allow an attached child.

#### Scenario: Default options applied on Linux
- **WHEN** `spawnDetached({ cmd: "/bin/sleep", args: ["1"], platform: "linux" })` is called
- **THEN** Node's `spawn()` SHALL be invoked with `detached: true, windowsHide: true, shell: false`
- **AND** `stdio` SHALL be `["ignore", "ignore", "ignore"]`
- **AND** `child.unref()` SHALL be called
- **AND** the function SHALL return `{ ok: true, pid: <number>, process: <ChildProcess> }`

#### Scenario: Default options applied on Windows
- **WHEN** `spawnDetached({ cmd: "C:\\Program Files\\nodejs\\node.exe", args: ["cli.js"], platform: "win32" })` is called
- **THEN** Node's `spawn()` SHALL be invoked with `detached: true, windowsHide: true, shell: false`
- **AND** `stdio` SHALL be `["ignore", "ignore", "ignore"]`
- **AND** `child.unref()` SHALL be called

#### Scenario: stderr redirected to file fd when logFd provided
- **WHEN** `spawnDetached({ cmd, args, logFd: 5 })` is called
- **THEN** `stdio` SHALL be `["ignore", "ignore", 5]`

#### Scenario: Windows detached is excluded from parent kill-on-close job
- **WHEN** `spawnDetached({ cmd, args, platform: "win32" })` is called
- **THEN** the child SHALL NOT be assigned to the Node process's libuv global Job Object
- **AND** the child SHALL survive the parent process exiting (PGID-equivalent lifecycle)

#### Scenario: Spawn error returns ok:false with message
- **WHEN** `spawnDetached` is called with a `cmd` that does not exist
- **THEN** the function SHALL return `{ ok: false, error: "<message>" }` within 200 ms
- **AND** SHALL NOT throw

### Requirement: Wait for no crash during fixed window
The module SHALL export `waitForNoCrash({ child, windowMs, captureStderrBytes? })` that monitors a spawned child for `windowMs` milliseconds. If the child's `exit` event fires within the window, the function SHALL return `{ ok: false, exitCode, stderrTail }`. If the window elapses without an exit event, the function SHALL return `{ ok: true }`. The `captureStderrBytes` option SHALL bound the size of the stderr ring buffer; when 0 or absent, no stderr capture is performed. The function SHALL NOT depend on the child still being referenced (it SHALL work for unref'd children).

#### Scenario: Child survives window
- **WHEN** `waitForNoCrash({ child, windowMs: 300 })` is called on a process that stays alive for at least 300 ms
- **THEN** the function SHALL return `{ ok: true }` after ≥ 300 ms

#### Scenario: Child exits early
- **WHEN** `waitForNoCrash({ child, windowMs: 300 })` is called on a process that exits with code 1 after 50 ms
- **THEN** the function SHALL return `{ ok: false, exitCode: 1 }`

#### Scenario: Stderr tail captured when requested
- **WHEN** `waitForNoCrash({ child, windowMs: 300, captureStderrBytes: 4096 })` is called AND the child exits early after writing "boom" to stderr
- **THEN** the returned `stderrTail` SHALL contain "boom"

#### Scenario: Stderr tail bounded to byte limit
- **WHEN** `captureStderrBytes: 1024` is passed AND the child writes 8 KB to stderr before exit
- **THEN** the returned `stderrTail` SHALL contain at most 1024 bytes (the tail of the stream)

### Requirement: Wait for positive readiness signal
The module SHALL export `waitForReady({ probe, deadlineMs, pollIntervalMs?, child? })` that polls `probe()` at `pollIntervalMs` intervals (default 500 ms) until either `probe()` resolves to `true` (`{ ok: true }`) or `deadlineMs` elapses (`{ ok: false, error: "timeout" }`). If `child` is provided AND emits an `error` event OR exits with a non-zero code before the deadline, the function SHALL return `{ ok: false, error }` early without waiting for the deadline.

#### Scenario: Probe succeeds before deadline
- **WHEN** `waitForReady({ probe: () => Promise.resolve(true), deadlineMs: 5000 })` is called
- **THEN** the function SHALL return `{ ok: true }` within one poll interval

#### Scenario: Probe never succeeds
- **WHEN** `waitForReady({ probe: () => Promise.resolve(false), deadlineMs: 1000, pollIntervalMs: 100 })` is called
- **THEN** the function SHALL return `{ ok: false, error: "timeout" }` after ~1000 ms

#### Scenario: Child crash shortcuts the wait
- **WHEN** `waitForReady({ probe, deadlineMs: 15000, child })` is called AND `child` emits `error` after 200 ms
- **THEN** the function SHALL return `{ ok: false, error: <message> }` near 200 ms (not 15000 ms)

### Requirement: Platform override for tests
All three exported functions SHALL accept an optional `platform: NodeJS.Platform` parameter on any helper whose behaviour differs across OSes. The parameter SHALL default to `process.platform` in production and SHALL be explicitly passed by tests. Tests SHALL NOT mutate `process.platform` and SHALL NOT use `vi.mock` for this purpose.

#### Scenario: Tests pass explicit platform
- **WHEN** a unit test invokes a helper with `platform: "win32"`
- **THEN** the helper SHALL behave as on Windows regardless of `process.platform`
