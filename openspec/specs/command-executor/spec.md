# command-executor Specification

## Purpose

Single source of truth for spawning child processes on the server. Consolidates process execution behind one module and one `run()` function that always applies the safety defaults (including `windowsHide`), expresses per-tool invocations as pure-data recipes with binary resolution done by the runner, and returns errors as a result value instead of throwing. Also owns cross-platform process-tree termination so no caller reimplements killing a process.

## Requirements

### Requirement: Single-source child_process module
All code in `packages/server/src`, `packages/extension/src`, `packages/electron/src`, and `packages/shared/src` (excluding `packages/shared/src/platform/exec.ts` and `packages/shared/src/platform/runner.ts`) SHALL import subprocess functions from `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`, not directly from `node:child_process`. A repo-level test SHALL enforce this invariant.

#### Scenario: No direct child_process import outside the wrapper
- **WHEN** the test suite scans every `.ts` file under `packages/*/src/` (excluding `__tests__/`) for direct `node:child_process` imports
- **THEN** the only files that may import from `node:child_process` are `packages/shared/src/platform/exec.ts` and `packages/shared/src/platform/runner.ts`
- **AND** any other match SHALL cause the test to fail with the offending file paths

#### Scenario: Adding a new spawn site
- **WHEN** a developer adds a new call to `execSync` / `execFile` / `spawn` / `spawnSync` / `exec` / `fork` in a non-exempt file
- **THEN** they SHALL import it from `@blackbelt-technology/pi-dashboard-shared/platform/exec.js`
- **AND** the import-ban test SHALL pass without modification

### Requirement: exec.ts sets windowsHide: true by default
The `packages/shared/src/platform/exec.ts` module SHALL export wrapped versions of `execSync`, `exec`, `execFile`, `spawnSync`, `spawn`, `execAsync`, and `execFileAsync`. Each wrapper SHALL set `windowsHide: true` in the options passed to the underlying Node function unless the caller explicitly sets `windowsHide: false`.

#### Scenario: execSync inherits windowsHide: true
- **WHEN** a caller invokes `execSync("cmd", opts)` from the wrapper without specifying `windowsHide`
- **THEN** the underlying `node:child_process.execSync` SHALL be invoked with `opts.windowsHide === true`

#### Scenario: Explicit windowsHide: false is honored
- **WHEN** a caller invokes `execSync("cmd", { windowsHide: false })`
- **THEN** the underlying call SHALL be invoked with `windowsHide === false`

#### Scenario: All wrappers apply the same default
- **WHEN** each of `execSync`, `exec`, `execFile`, `spawnSync`, `spawn`, `execAsync`, `execFileAsync` is called without explicit `windowsHide`
- **THEN** the underlying Node function SHALL receive `windowsHide: true`

#### Scenario: spawn without arguments array
- **WHEN** a caller invokes `spawn("cmd")` without an args array
- **THEN** the wrapper SHALL pass `[]` to the underlying `spawn` and include `windowsHide: true`

### Requirement: runner.ts exposes a single run() function
The `packages/shared/src/platform/runner.ts` module SHALL export a single `run<I, O>(recipe, input, ctx?)` function that executes a `Recipe<I, O>` against a typed `input`, returning a typed `Result<O>`.

#### Scenario: Successful recipe execution
- **WHEN** `run(recipe, input)` is called and the underlying subprocess exits with code 0
- **THEN** the result SHALL be `{ ok: true, value: recipe.parse(stdout, input) }`

#### Scenario: Non-zero exit with tolerated code
- **WHEN** `run(recipe, input)` is called and the subprocess exits with a code listed in `recipe.tolerate`
- **THEN** the result SHALL be `{ ok: true, value: recipe.parse(stdout, input) }` (parsed as if successful)

#### Scenario: Non-zero exit without tolerated code
- **WHEN** `run(recipe, input)` is called and the subprocess exits with a non-zero code NOT in `recipe.tolerate`
- **THEN** the result SHALL be `{ ok: false, error: { kind: "exit", code, signal, stdout, stderr } }`

#### Scenario: Binary not found
- **WHEN** `run(recipe, input)` is called and `ToolResolver.which(recipe.argv(input)[0])` returns null
- **THEN** the result SHALL be `{ ok: false, error: { kind: "not-found", binary } }`
- **AND** no spawn SHALL be attempted

#### Scenario: Timeout exceeded
- **WHEN** `run(recipe, input)` is called and the subprocess does not exit before `recipe.timeout` (default 5000ms)
- **THEN** the child SHALL be terminated
- **AND** the result SHALL be `{ ok: false, error: { kind: "timeout", timeoutMs } }`

#### Scenario: Spawn failure (OS-level)
- **WHEN** `run(recipe, input)` is called and the OS fails to spawn the child (e.g. permission denied)
- **THEN** the result SHALL be `{ ok: false, error: { kind: "spawn-failure", message } }`

### Requirement: Runner always applies safety defaults
The runner SHALL apply these options to every subprocess it spawns, overridable per-recipe:
- `windowsHide: true`
- `stdio: ["pipe", "pipe", "pipe"]`
- `encoding: "utf-8"`
- `shell: false` (always argv array; arguments are never shell-interpolated)
- `timeout: 5000` (default; recipes may override)

#### Scenario: windowsHide always true
- **WHEN** any recipe is executed
- **THEN** the underlying spawn SHALL use `windowsHide: true`

#### Scenario: shell: false always
- **WHEN** any recipe is executed
- **THEN** the underlying spawn SHALL be invoked with an argv array, not a shell-interpolated string
- **AND** path components containing spaces or special characters SHALL be passed verbatim in the args array

### Requirement: Recipes are pure data
A `Recipe<I, O>` object SHALL be serializable data (no closures over mutable state beyond `argv` and `parse`, which are pure functions). A recipe SHALL NOT reference `process.platform` inside its `argv` or `parse` functions.

#### Scenario: Recipes serialize to inspectable JSON except for functions
- **WHEN** a recipe is inspected (e.g. `Object.keys(recipe)`)
- **THEN** the keys SHALL be a subset of `{ argv, parse, timeout, tolerate, cwd, stdin }`

#### Scenario: Recipes do not branch on platform
- **WHEN** a recipe's `argv(input)` function is called on any OS
- **THEN** the returned argv SHALL be platform-independent
- **AND** per-OS alternatives SHALL be expressed as separate Recipe objects (e.g. `LIST_PROCESSES_WMIC` vs `LIST_PROCESSES_PS`), selected by the Tool-module layer

### Requirement: Binary resolution happens in the runner
The runner SHALL resolve the command name (first element of `recipe.argv(input)`) to an absolute path via `ToolResolver.which` before spawning. Resolved paths SHALL be cached per command name for the lifetime of the process.

#### Scenario: First call resolves the binary
- **WHEN** `run(recipe, input)` is called for the first time with a given command name
- **THEN** `ToolResolver.which(commandName)` SHALL be invoked once
- **AND** the result (or null) SHALL be cached

#### Scenario: Subsequent calls reuse the cache
- **WHEN** `run(recipe, input)` is called again with the same command name
- **THEN** the cached resolution SHALL be used without re-invoking `ToolResolver.which`

#### Scenario: Cache reset for tests
- **WHEN** the test-only helper `resetResolverCache()` is called
- **THEN** the next `run()` call SHALL re-invoke `ToolResolver.which`

### Requirement: platform/git.ts exports a Recipe-based API
The `packages/shared/src/platform/git.ts` module SHALL expose typed functions for the git operations currently invoked via inline `execSync` across the codebase: `diff`, `status`, `branches`, `currentBranch`, `headSha`, `remoteUrl`, `isGitRepo`, `checkout`, `stash`, `stashPop`. Each function SHALL internally call `run(GIT_RECIPES.X, input, ctx)` and SHALL NOT contain `execSync`, `spawn`, or `process.platform`.

#### Scenario: git.diff routes through the runner
- **WHEN** `git.diff({ path, cwd })` is called
- **THEN** it SHALL invoke `run(GIT_RECIPES.GIT_DIFF, { path }, { cwd })`
- **AND** SHALL NOT contain any direct `child_process` import

#### Scenario: Every git call site uses the module
- **WHEN** the repo is inspected for `execSync("git ...")` or `execSync(\`git ...\`)` patterns
- **THEN** matches SHALL be limited to the `GIT_RECIPES` registry definitions inside `platform/git.ts`

### Requirement: platform/openspec.ts supersedes openspec-poller.ts
The `packages/shared/src/platform/openspec.ts` module SHALL expose Recipe-based `list`, `status`, `archive` operations. The existing `openspec-poller.ts` `pollOpenSpec` and `pollOpenSpecAsync` APIs SHALL be preserved as thin wrappers over the new module for back-compat during migration. Callers SHALL migrate to the new API within this change or in a follow-up.

#### Scenario: pollOpenSpec back-compat
- **WHEN** a caller invokes `pollOpenSpec(cwd)` from the old module path
- **THEN** the call SHALL succeed with identical return shape and semantics as before the migration

#### Scenario: New callers use platform/openspec
- **WHEN** a new caller needs openspec list/status/archive
- **THEN** it SHALL import from `@blackbelt-technology/pi-dashboard-shared/platform/openspec.js`
- **AND** not from `@blackbelt-technology/pi-dashboard-shared/openspec-poller.js`

### Requirement: platform/npm.ts exports a Recipe-based API
The `packages/shared/src/platform/npm.ts` module SHALL expose typed functions for the npm operations currently invoked via inline `execSync` across the codebase: `rootGlobal`, `outdated`, `install`, `remove`, `viewVersion`. Each function SHALL route through the runner.

#### Scenario: npm.rootGlobal replaces inline execSync
- **WHEN** a caller needs the global npm root
- **THEN** it SHALL call `npm.rootGlobal()` from `platform/npm.ts`
- **AND** inline `execSync("npm root -g")` SHALL NOT appear elsewhere in the codebase

### Requirement: Result type surfaces errors without throwing
`run()` SHALL return `Result<T> = { ok: true; value: T } | { ok: false; error: ExecError }` and SHALL NOT throw for the error classes: "not-found", "exit", "timeout", "spawn-failure". Callers receive errors as typed values.

#### Scenario: Best-effort caller with unwrap helper
- **WHEN** a caller uses `unwrap(git.diff(input), "")` to get a default on any error
- **THEN** the call SHALL return the parsed string on success or `""` on any error kind

#### Scenario: Caller distinguishes error kinds
- **WHEN** a caller checks `if (!result.ok && result.error.kind === "not-found") { ... }`
- **THEN** the error discriminant SHALL be available as a typed string union

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
