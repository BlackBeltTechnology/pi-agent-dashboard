## MODIFIED Requirements

### Requirement: Install test
The system SHALL verify that the npm-global install of the dashboard succeeds on a clean VM, including native module compilation (node-pty). The installed package SHALL be `$QA_NPM_SPEC` when set, else `@blackbelt-technology/pi-agent-dashboard`.

#### Scenario: Successful npm install on Linux
- **WHEN** the install test runs on a Linux VM
- **THEN** `npm install -g @blackbelt-technology/pi-agent-dashboard` exits with code 0 and `pi-dashboard --version` returns a version string

#### Scenario: Successful npm install on Windows
- **WHEN** the install test runs on a Windows VM
- **THEN** `npm install -g @blackbelt-technology/pi-agent-dashboard` exits with code 0 and node-pty compiles against ConPTY

#### Scenario: Successful npm install on macOS
- **WHEN** the install test runs on a macOS VM
- **THEN** `npm install -g @blackbelt-technology/pi-agent-dashboard` exits with code 0

#### Scenario: node-pty loads from the installed package
- **WHEN** the install test has installed the package
- **THEN** it loads `node-pty` from the installed package's module directories and fails when it cannot be loaded

#### Scenario: Pinned install
- **WHEN** `QA_NPM_SPEC=@blackbelt-technology/pi-agent-dashboard@0.10.0` is set
- **THEN** the install test installs exactly that spec and `pi-dashboard --version` reports `0.10.0`

### Requirement: Server start test
The system SHALL verify that `pi-dashboard start` launches the server and the health endpoint responds.

#### Scenario: Server starts and responds
- **WHEN** the server start test runs
- **THEN** `pi-dashboard start` succeeds, and `GET http://127.0.0.1:8000/api/health` returns HTTP 200 within 15 seconds

### Requirement: WebSocket connection test
The system SHALL verify that the pi gateway port (9999) and the dashboard port (8000) accept connections on `127.0.0.1`. A full WebSocket-upgrade check is out of scope for this test.

#### Scenario: WebSocket connects
- **WHEN** the WebSocket test runs
- **THEN** TCP connections to `127.0.0.1:9999` and `127.0.0.1:8000` both succeed

### Requirement: Terminal spawning test
The system SHALL verify that PTY-based terminal spawning works on each platform.

#### Scenario: Terminal spawns on Linux/macOS
- **WHEN** the terminal test runs on Linux or macOS
- **THEN** a terminal session is created via the API and shell output is received

#### Scenario: Terminal spawns on Windows
- **WHEN** the terminal test runs on Windows
- **THEN** a terminal session is created via the API, and node-pty spawns PowerShell through ConPTY and receives its output

### Requirement: Git operations test
The system SHALL verify that server-side git operations (branch listing, init) work on each platform.

#### Scenario: Git operations succeed
- **WHEN** the git test runs in a directory with a git repo
- **THEN** the branch list API returns at least one branch

#### Scenario: API failure is not masked
- **WHEN** `GET /api/git/branches` fails or returns no branch
- **THEN** the git test fails, and does not fall back to a local `git branch` listing

### Requirement: Test runner with results
The system SHALL provide `run-all.sh` (Linux/macOS) and `run-all.ps1` (Windows) runners that execute all listed tests in order, collect PASS / FAIL / precondition-skip results, and output a summary. Each runner SHALL declare per test whether it needs a running dashboard server.

#### Scenario: All tests pass
- **WHEN** a runner executes and all tests pass
- **THEN** the script outputs a summary showing all tests as PASS and exits with code 0

#### Scenario: Some tests fail
- **WHEN** a runner executes and some tests fail
- **THEN** the script outputs a summary showing which tests failed and exits with a non-zero code

#### Scenario: Precondition skips do not fail the suite
- **WHEN** every test passes except some that exit 77
- **THEN** those tests are listed as precondition-skipped and the runner exits 0

### Requirement: Cross-platform test compatibility
The system SHALL use bash scripts for Linux/macOS tests and PowerShell scripts for Windows tests, with a shared test protocol (exit codes, output format). Windows test scripts SHALL run unmodified under Windows PowerShell 5.1 and PowerShell 7.

#### Scenario: Windows tests use PowerShell
- **WHEN** tests execute on a Windows VM or host
- **THEN** they are staged by `qa/remote/run.sh` (the `windows-remote-qa` harness) and `run-all.ps1` is invoked by `remote-cycle.ps1` within one SSH session, using the `-ExecutionPolicy Bypass -File` invocation form preflight selected

#### Scenario: Unix tests use bash
- **WHEN** tests execute on a Linux or macOS VM
- **THEN** the test runner invokes `.sh` scripts via bash over SSH

## ADDED Requirements

### Requirement: Runner-owned shared-server fixture
Before running each test declared as needing a server, a runner SHALL ensure `GET http://127.0.0.1:8000/api/health` returns 200, starting the dashboard when it does not. After starting a server, the runner SHALL assert that `~/.pi/dashboard/server.log` grew. When the server cannot be made healthy within 60 s, the runner SHALL record that test as FAIL with reason `fixture: server did not start` and SHALL NOT execute it. After the last test the runner SHALL stop the server.

#### Scenario: Server-dependent test after a self-stopping test
- **WHEN** `02-server-start` has stopped its server on exit and `03-websocket` is next
- **THEN** the runner starts a server, logs `fixture: started server`, and `03-websocket` finds `/api/health` = 200

#### Scenario: Fixture failure is attributed, not cascaded
- **WHEN** the dashboard cannot start (for example port 8000 held by a foreign process)
- **THEN** each server-dependent test is reported as `FAIL <name> (fixture: server did not start)` without being run
- **AND** tests that do not need a server still run

#### Scenario: Wrong kind of server in Electron fixture mode
- **WHEN** `QA_FIXTURE_EXE` is set and a healthy server with `launchSource == "standalone"` holds port 8000
- **THEN** the fixture stops it and launches the Electron app before the next server-dependent test

#### Scenario: Stale log does not satisfy the fixture
- **WHEN** `server.log` already holds content from an earlier test and the fixture's start writes nothing
- **THEN** the fixture fails with `fixture: server did not start`

#### Scenario: Bridge-only test under the fixture
- **WHEN** `38-poll-cost.ps1` runs against the fixture's standalone server
- **THEN** it exits 77 (not bridge-started) and is reported as precondition-skipped, not FAIL

#### Scenario: POSIX parity
- **WHEN** `run-all.sh` runs on Linux or macOS after `02-server-start.sh`
- **THEN** `03-websocket.sh` runs against a fixture-started server instead of failing with "Server not running"

### Requirement: Windows fixture launches the artifact under test
When `QA_FIXTURE_EXE` names a `pi-dashboard.exe`, `run-all.ps1`'s fixture SHALL start the server by launching that Electron app; otherwise it SHALL use the dashboard CLI.

#### Scenario: Electron fixture in harness zip mode
- **WHEN** `run-all.ps1` runs with `QA_FIXTURE_EXE` set to the deployed `pi-dashboard.exe`
- **THEN** the fixture-started server reports `launchSource == "electron"` and `10-bundled-git.ps1` runs its bundled-git assertions instead of skipping

#### Scenario: CLI fixture in npm mode
- **WHEN** `QA_FIXTURE_EXE` is unset
- **THEN** the fixture starts the server with the npm-installed CLI and it reports `launchSource == "standalone"`

### Requirement: Exit 77 means precondition not met on Windows
A Windows test script (`qa/tests/*.ps1`) that cannot establish its own precondition SHALL print a `SKIP:` reason and exit 77, never 0. A checkout-dependent Windows test SHALL exit 77 when no checkout containing its marker path is found. The POSIX `SKIP:` first-line convention is unchanged.

#### Scenario: Missing openspec bin or Git Bash
- **WHEN** `12-openspec-shim.ps1` runs without the pinned openspec bin, or without Git for Windows' `bash.exe`
- **THEN** it exits 77 and `run-all.ps1` reports it as precondition-skipped, not PASS
- **AND** `C:\Windows\System32\bash.exe` (the WSL launcher) is never treated as Git Bash

#### Scenario: Bundled git needs an Electron-launched server
- **WHEN** `10-bundled-git.ps1` runs against a server whose `launchSource` is not `electron`
- **THEN** it exits 77

#### Scenario: CLI absent
- **WHEN** `32-origin-gate.ps1` runs with no `pi-dashboard` on PATH
- **THEN** it exits 77

#### Scenario: Checkout resolution order
- **WHEN** a checkout-dependent Windows test resolves its repository
- **THEN** it tries `PI_DASHBOARD_REPO`, then `QA_REPO_ROOT`, then the script's grandparent directory, accepting the first that contains its marker path
- **AND** it never falls back to the current directory

#### Scenario: Legacy repo variable honoured
- **WHEN** `QA_REPO_ROOT` points at a checkout and `PI_DASHBOARD_REPO` is unset
- **THEN** `45-windows-reclaim-refused.ps1` uses that checkout instead of exiting 77

#### Scenario: POSIX convention unchanged
- **WHEN** `10-faux-model.sh` prints `SKIP:` as its first line and exits 0
- **THEN** `run-all.sh` still reports it as SKIP

#### Scenario: Checkout-only tests on a harness host
- **WHEN** `12-keeper-log-rotation.ps1`, `17-bridge-contention.ps1`, `40-agent-path-gate-windows.ps1` or `45-windows-reclaim-refused.ps1` runs from a staged `tests\` directory with no repository and no `PI_DASHBOARD_REPO`
- **THEN** each exits 77

#### Scenario: Never-run tests are listed
- **WHEN** `run-all.ps1` executes
- **THEN** its list includes `12-keeper-log-rotation.ps1`, `17-bridge-contention.ps1` and `45-windows-reclaim-refused.ps1`

### Requirement: Windows scripts launch the CLI as an executable
Windows test scripts SHALL NOT pass the bare name `pi-dashboard` to `Start-Process`. They SHALL launch the CLI's `.cmd` shim through `cmd.exe`, and SHALL stop servers with `pi-dashboard stop [--port N]` rather than by killing the launched process.

#### Scenario: npm-global install with a `.ps1` shim first on PATH
- **WHEN** the npm prefix contains `pi-dashboard.ps1` and `pi-dashboard.cmd`
- **AND** `02-server-start.ps1`, `16-windows-path-casing.ps1` or `32-origin-gate.ps1` starts the server
- **THEN** the launch starts the server instead of failing with "not a valid Win32 application" (with redirection) or silently not running the CLI (without)

#### Scenario: Shim resolution and quoting
- **WHEN** a test launches the CLI
- **THEN** it resolves the `.cmd` shim with `Get-Command -CommandType Application` (never the `.ps1` or the extensionless sh shim) and runs `cmd.exe /d /s /c ""<exe>" <args>"`, which survives an install path containing spaces

#### Scenario: Server on a custom port is stopped
- **WHEN** `32-origin-gate.ps1` finishes (pass or fail) after starting a server on port 18870
- **THEN** nothing listens on 18870 afterwards

#### Scenario: First-start output is captured
- **WHEN** `02-server-start.ps1` starts the server with its stdout redirected to a file
- **THEN** the file contains `Dashboard server started (pid N)`

### Requirement: Windows scripts tolerate native stderr under PowerShell 5.1
In a Windows test script that sets `$ErrorActionPreference = "Stop"`, every native command whose stderr is redirected (`2>&1`, `2>$null`, `*>`) SHALL run through the `Invoke-Native` helper or inside a single-line `try { … } catch { }` no-op. Success SHALL be judged by exit code. Writing to stderr alone SHALL NOT fail a test.

#### Scenario: npm deprecation warning
- **WHEN** `35-plugin-install-load.ps1` runs `npm install` and npm writes `npm warn deprecated …` to stderr with exit code 0
- **THEN** the script continues

#### Scenario: Usage text on stderr
- **WHEN** `44-photocraft.ps1` runs `pi-photocraft --help` and the CLI prints usage to stderr with exit code 0
- **THEN** the script continues

#### Scenario: Output-consuming native call
- **WHEN** `44-photocraft.ps1` pipes MCP requests into `pi-photocraft mcp` and the CLI logs to stderr
- **THEN** the script parses only the stdout lines as JSON and the stderr lines do not fail it

### Requirement: Windows ZIP launch end-to-end asserts the current bundle
`07-electron-bootstrap-v2.ps1` SHALL verify the Electron ZIP against the bundle layout the current release ships. It SHALL NOT assert artifacts that releases no longer produce.

#### Scenario: A server already running is stopped first
- **WHEN** a fixture-started dashboard holds port 8000 or 8112 when `07` begins
- **THEN** `07` stops it (via `pi-dashboard stop` or by the `pi-dashboard` image name) before launching, and the health it asserts comes from the Electron app it extracted (`launchSource == "electron"`)

#### Scenario: Foreign listener is reported, not killed
- **WHEN** a non-dashboard process holds port 8000 after `07`'s stop step
- **THEN** `07` fails naming that process and does not terminate it

#### Scenario: Skip path has no side effects
- **WHEN** no zip for the host architecture is staged while a fixture server is running
- **THEN** `07` exits 77 and the fixture server is still running

#### Scenario: Layout assertions
- **WHEN** `07` extracts a staged zip (via `System.IO.Compression.ZipFile`)
- **THEN** it asserts the bundled server CLI and `resources\node\node.exe`
- **AND** it does not assert the offline-package cache or the `~/.pi-dashboard` runtime install

#### Scenario: Runtime assertions
- **WHEN** `07` launches `pi-dashboard.exe`
- **THEN** `/api/health` on `127.0.0.1:8000` answers within 180 s with `launchSource == "electron"` (not the removed `starter` field)
- **AND** `~\.pi\dashboard\server.log` is non-empty

#### Scenario: Time budget
- **WHEN** `07` runs on a Windows PowerShell 5.1 host
- **THEN** extraction + launch + health complete within 600 s, measured by `07` itself, and `07` fails (printing the measured seconds) when the budget is exceeded

#### Scenario: v0.10.0 x64 zip
- **WHEN** `PI-Dashboard-win32-x64.zip` v0.10.0 is staged
- **THEN** `07` passes, reporting `launchSource=electron`

#### Scenario: arm64 zip
- **WHEN** both `PI-Dashboard-win32-x64.zip` and `PI-Dashboard-win32-arm64.zip` are staged on an arm64 host (`PROCESSOR_ARCHITECTURE=ARM64`)
- **THEN** `07` uses the arm64 zip

#### Scenario: No zip staged
- **WHEN** `C:\qa-artifacts` holds no zip for the host's architecture
- **THEN** `07` prints `SKIP:` and exits 77

### Requirement: Packer Windows flow runs through the remote harness
`qa/scripts/run-test.sh` SHALL run Windows VM tests by invoking `qa/remote/run.sh` against the cloned VM with `--host`, `--user`, `--key` and `--known-hosts <per-run temp file>`, keeping `StrictHostKeyChecking=accept-new`. It SHALL use `--mode zip --artifact <zip>` when the Electron zip exists, else `--mode npm --npm-version <QA_NPM_VERSION or latest>`, and SHALL propagate the driver's exit code.

#### Scenario: make test-windows
- **WHEN** the operator runs `make -C qa test-windows` with a built Windows Packer image and a staged zip
- **THEN** `run-test.sh` clones the VM, waits for SSH, runs `qa/remote/run.sh --mode zip --artifact <zip> --known-hosts <temp>` against it, propagates its exit code, deletes the temp file, and destroys the clone

#### Scenario: Recycled VM IP with a new host key
- **WHEN** a second `make -C qa test-windows` run gets a clone on the same IP with a different host key
- **THEN** the run succeeds, because each run starts from an empty known-hosts file
- **AND** `qa/remote/.known_hosts` is not modified

### Requirement: Terminal test resolves node-pty from the installed dashboard
`04-terminal.ps1` SHALL load `node-pty` from the globally installed `@blackbelt-technology/pi-agent-dashboard` package, not from its working directory, and SHALL exit 77 when that package is not installed.

#### Scenario: Staged suite without node_modules
- **WHEN** `04-terminal.ps1` runs from `C:\pi-dashboard-qa\tests\` (no `node_modules` nearby) after the npm-global install
- **THEN** its node-pty check spawns `powershell.exe` and observes `hello-pty`

#### Scenario: Package not installed
- **WHEN** `npm root -g` holds no `@blackbelt-technology/pi-agent-dashboard`
- **THEN** `04-terminal.ps1` exits 77
