## ADDED Requirements

### Requirement: Single-source process-termination module
All code in `packages/server/src`, `packages/extension/src`, `packages/electron/src`, and `packages/shared/src` (excluding `packages/shared/src/platform/process.ts` and `packages/shared/src/platform/exec.ts`) SHALL terminate processes exclusively via helpers exported from `@blackbelt-technology/pi-dashboard-shared/platform/process.js` (`isProcessAlive`, `killProcess`, `killPidWithGroup`). Direct calls to `process.kill(pid, …)` outside the platform module are prohibited. A repo-level test SHALL enforce this invariant.

#### Scenario: No direct process.kill outside the platform module
- **WHEN** the test suite scans every `.ts` file under `packages/*/src/` (excluding `__tests__/` and `packages/shared/src/platform/`)
- **THEN** no file SHALL contain a call matching the regex `\bprocess\.kill\s*\(`
- **AND** any match SHALL cause the test to fail with the offending file paths and line numbers

#### Scenario: Adding a new termination site
- **WHEN** a developer needs to terminate a PID, check liveness, or kill a process group
- **THEN** they SHALL import the appropriate helper (`isProcessAlive`, `killProcess`, or `killPidWithGroup`) from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`
- **AND** the enforcement test SHALL pass without modification

#### Scenario: Platform module is exempt
- **WHEN** the scanner encounters files under `packages/shared/src/platform/`
- **THEN** those files SHALL be skipped
- **AND** their internal use of `process.kill` SHALL NOT cause failures

### Requirement: Cross-platform tree termination uses killProcess
Code that needs to terminate a spawned session, editor, tunnel, or any process whose descendants MUST also be terminated SHALL use `killProcess(pid, opts)` from the platform module. On Windows this SHALL invoke `taskkill /F /T /PID <pid>`; on POSIX this SHALL send SIGTERM, wait up to `timeoutMs` (default 5000), then SIGKILL if the process is still alive.

#### Scenario: Windows tree kill
- **WHEN** `killProcess(pid)` is invoked with `platform: "win32"`
- **THEN** the platform SHALL execute `taskkill /F /T /PID <pid>` via the wrapped `execSync`
- **AND** return `{ ok: true, forced: false }` on success

#### Scenario: POSIX escalation path
- **WHEN** `killProcess(pid, { timeoutMs: 2000 })` is invoked with `platform: "linux"` or `platform: "darwin"` on a live PID
- **THEN** the platform SHALL send `SIGTERM` to `pid`
- **AND** poll liveness every 200ms until `timeoutMs` elapses
- **AND** send `SIGKILL` if the process is still alive when the deadline passes
- **AND** return `{ ok: true, forced: true }` when SIGKILL was required

#### Scenario: Already-dead process
- **WHEN** `killProcess(pid)` is invoked for a PID that is not alive
- **THEN** the platform SHALL return `{ ok: false, forced: false }` without sending any signal
