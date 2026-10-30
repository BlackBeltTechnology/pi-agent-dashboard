# Test Plan — repair-windows-qa-suite

Stage: design   Generated: 2026-10-25

Hard gate resolved (2026-10-25): `07` budget = 600 s, asserted; full-suite wall clock = recorded only, no threshold. There are no open clarifications.

Levels: **L1** = vitest under `packages/shared/src/__tests__/` (POSIX CI). **L2** = `qa/tests/*.ps1` / `*.sh` executed on a real host. The Windows host is a Windows PowerShell 5.1 machine reached through the `qa/remote` harness; with no LAN host, that is the `windows-latest` self-ssh method (`automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml`). The POSIX hosts are `ubuntu-latest` / `macos-latest`. **ci** = an existing workflow on the PR.

Helper self-tests (E4–E10) live in a new L2 script `qa/tests/00-qa-common-selftest.ps1`, the first entry in `run-all.ps1`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Windows scripts launch the CLI as an executable | static scan | L1 | automated | a `qa/tests/*.ps1` containing `Start-Process -FilePath "pi-dashboard"` | `npm test` runs `qa-windows-ps1-compat.test.ts` | test fails naming file:line; passes on the fixed tree |
| E2 | Exit 77 — never-run tests are listed | static scan | L1 | automated | `run-all.ps1` without `17-bridge-contention.ps1`, or listing a file that does not exist | `npm test` | test fails naming the missing or nonexistent entry |
| E3 | Exit 77 means precondition not met on Windows | static scan | L1 | automated | a `.ps1` with a `SKIP:` line followed by `exit 0` within 3 lines | `npm test` | test fails naming file:line |
| E4 | Shim resolution and quoting | EP (shim kinds) | L2 | automated | temp PATH dir holding `pi-dashboard` (sh), `pi-dashboard.cmd`, `pi-dashboard.ps1` | `Get-PiDashboardExe` | returns the `.cmd` path; returns `$null` when only the `.ps1` + sh exist |
| E5 | Shim resolution and quoting | BVA (spaces) | L2 | automated | stub `C:\qa sp\pi-dashboard.cmd` that writes `%*` to a file; args `start`, `a b` | `Start-PiDashboard -ArgumentList start,'a b'` then `WaitForExit` | file contains exactly `"start" "a b"`; the cmd process exits 0 |
| E6 | Windows scripts tolerate native stderr under PowerShell 5.1 | fault (stderr) | L2 | automated | `$ErrorActionPreference='Stop'`; block `{ cmd /c "echo out & echo err 1>&2 & exit 3" 2>&1 }` | `Invoke-Native` | no exception; `ExitCode` 3; `Stdout` = `out`; `Stderr` = `err`; `Text` has both, in order |
| E7 | Output-consuming native call | EP (stdin) | L2 | automated | `$in = 'ping'`; block `{ $in \| node -e "process.stdin.pipe(process.stdout)" 2>&1 }` | `Invoke-Native` | `Stdout` = `ping`, `ExitCode` 0 |
| E8 | Windows scripts tolerate native stderr under PowerShell 5.1 | state (stale code) | L2 | automated | a previous `cmd /c exit 5`; block with no native call `{ 'x' }` | `Invoke-Native` | `ExitCode` 0, not 5 |
| E9 | Checkout resolution order | decision table | L2 | automated | cases: (a) `PI_DASHBOARD_REPO` lacks marker, `QA_REPO_ROOT` has it; (b) neither env var, cwd has marker, grandparent does not | `Resolve-RepoCheckout -Marker packages` | (a) returns `QA_REPO_ROOT`; (b) returns `$null` (no cwd fallback) |
| E10 | Missing openspec bin or Git Bash | EP (bash kinds) | L2 | automated | PATH with `C:\Windows\System32` first (WSL `bash.exe` present on `windows-latest`) + Git for Windows installed | `Get-GitBash` | returns `%ProgramFiles%\Git\bin\bash.exe` (the `windows-git-bash-runtime` order), never `System32\bash.exe`; with Git hidden (`ProgramFiles`/`ProgramFiles(x86)` → empty dirs, PATH trimmed to System32) returns `$null` |
| E11 | Runner-owned fixture + expected skips (zip mode) | decision table (mode × test) | L2 | automated | v0.10.0 zip, provisioned host, no checkout | `make -C qa test-windows-remote-zip` | `summary.json.exitCode` 0; precondition-skipped = {12-openspec-shim, 12-keeper-log-rotation, 17, 40, 45, 38}; every other entry PASS (incl. 07, 10) |
| E12 | Runner-owned fixture + expected skips (npm mode) | decision table (mode × test) | L2 | automated | `npmVersion` 0.10.0, provisioned host, no checkout | `make -C qa test-windows-remote-npm` | exit 0; precondition-skipped = E11 set ∪ {07, 10}; every other entry PASS |
| E13 | Windows ZIP e2e — arm64 zip | EP (arch) | L2 | automated | `windows-11-arm` runner; both win32 zips in `C:\qa-artifacts` | run `07` directly | log names `PI-Dashboard-win32-arm64.zip`; PASS with `launchSource=electron` |
| E14 | Windows ZIP e2e — skip path has no side effects | state | L2 | automated | no zip for host arch; fixture server healthy on 8000 | run `07` | exit 77; `GET 127.0.0.1:8000/api/health` still 200 afterwards |
| E15 | Install test — pinned install | BVA (version) | L2 | automated | `QA_NPM_SPEC=@blackbelt-technology/pi-agent-dashboard@0.10.0`; and separately `QA_NPM_SPEC` with no version | run `01-install.ps1` and `01-install.sh` | pinned: prints `0.10.0` and PASSes; unpinned: no version assertion, PASS |
| E16 | WebSocket connection test (127.0.0.1) | EP (address family) | L2 | automated | server listening on `127.0.0.1` only (fixture) | `03-websocket.ps1` | prints `Pi gateway (9999): OK`, `Browser WS (8000): OK`; exit 0 |
| E17 | Runner-owned fixture — POSIX parity, bash 3.2 | EP (shell version) | L2 | automated | `macos-latest` `/bin/bash` 3.2 and `ubuntu-latest` bash 5; npm-global install | `bash qa/tests/run-all.sh` | `bash -n` clean on 3.2; `fixture: started server` precedes `03-websocket.sh`, which does not report "Server not running" |
| E18 | Packer Windows flow runs through the remote harness | stub-driven | L2 | automated | stub `vm-clone.sh`/`vm-wait-ssh.sh`/`vm-destroy.sh` returning `127.0.0.1`; runner sshd; zip present | `qa/scripts/run-test.sh windows …` | `run.sh` invoked with `--host 127.0.0.1 --known-hosts <tmp> --mode zip --artifact <zip>`; rc = driver rc; temp file removed |
| E19 | Packer flow — POSIX branch unchanged | stub-driven (argv log) | L2 | automated | stub `ssh`/`scp` that log argv; same stubs for vm scripts | `run-test.sh linux-x86 …` before and after the change | identical logged `scp`/`ssh` argv sequence |
| E20 | Packer flow — recycled VM IP with a new host key | state | L2 | automated | E18 setup; regenerate the runner's sshd host keys between runs | run E18 twice | both runs succeed; `qa/remote/.known_hosts` unchanged (mtime + hash) |
| E21 | Shim resolution and quoting — path with spaces | BVA (spaces) | L2 | automated | `npm config set prefix "C:\npm prefix"`; reinstall the package | run `02`, `16`, `32` | each starts its server (health 200) and PASSes |
| E22 | Windows fixture launches the artifact under test | decision table (fixture kind) | L2 | automated | zip mode (`QA_FIXTURE_EXE` set) vs npm mode (unset) | `10-bundled-git.ps1` within `run-all.ps1` | zip: fixture logs `launchSource electron`, `10` PASSes its bundled-git assertions; npm: fixture logs `launchSource standalone`, `10` exits 77 |
| E23 | Bridge-only test under the fixture | state | L2 | automated | fixture standalone server | `38-poll-cost.ps1` | exit 77; summary lists it under precondition-skipped |
| E24 | First-start output is captured | EP | L2 | automated | clean host, npm install | `02-server-start.ps1` | redirected start file contains `Dashboard server started (pid N)`; the second start prints `already running (pid N)` with the same N; `server.log` grew |
| E25 | Git operations test — API failure is not masked | static scan | L1 | automated | `qa/tests/05-git-ops.ps1` | `npm test` | no `git branch --list` fallback after a failed `/api/git/branches` call; the failure path exits 1 |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Windows ZIP e2e — time budget | threshold | L2 | automated | v0.10.0 x64 zip (388 MB) on the `windows-latest` PS 5.1 host | `07` stopwatch over extract + launch + health ≤ 600 s (FAIL above; seconds always printed) | one `07` run |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Runner-owned fixture — after a self-stopping test | state-transition | L2 | automated | `02` stops the server on exit | `03` is next in `run-all.ps1` | output shows `fixture: started server (pid N, launchSource …)` before `Running: 03-websocket.ps1`; `03` PASS |
| X2 | Fixture failure is attributed, not cascaded | fault (abort) | L2 | automated | foreign `node` TCP server holding `127.0.0.1:8000` and answering 503 | run `run-all.ps1` | `03`/`04`/`05`/`10`/`17`/`22`/`38` reported `FAIL <name> (fixture: server did not start)` without running; `01`/`09`/`44` still execute; suite rc 1 |
| X3 | Stale log does not satisfy the fixture | fault | L2 | automated | `server.log` pre-filled; `QA_FIXTURE_EXE` = an exe that starts no server (`$env:ComSpec`) | fixture runs before `03` | `03` reported `FAIL (fixture: server did not start)` |
| X4 | Wrong kind of server in Electron fixture mode | state | L2 | automated | standalone server running; `QA_FIXTURE_EXE` set | fixture before the next ✓ test | fixture stops it; log line shows `launchSource electron`; health then reports `electron` |
| X5 | Windows scripts tolerate native stderr — npm warnings | fault (stderr) | L2 | automated | `npm install` writes `npm warn deprecated …` to stderr with rc 0 | `35-plugin-install-load.ps1` | no exception at `:136`; the test continues to its own assertions and PASSes |
| X6 | Usage text on stderr + output-consuming call | fault (stderr) | L2 | automated | `pi-photocraft --help` prints usage to stderr; `mcp` logs to stderr | `44-photocraft.ps1` | no exception at `:42`/`:69`; MCP `tools/list` parsed from stdout only; exit 0 |
| X7 | Server on a custom port is stopped | fault (forced failure) | L2 | automated | `32` forced to fail after start (temporarily set `$body` to invalid JSON) and a normal run | `32-origin-gate.ps1` | after both runs, `Get-NetTCPConnection -LocalPort 18870,19870` is empty |
| X8 | Foreign listener is reported, not killed | fault | L2 | automated | foreign `node` listener on 8000 after `07`'s stop step | `07` | `07` FAILs naming the process; that process is still alive afterwards |
| X9 | Terminal test resolves node-pty from the installed dashboard | fault (missing module) | L2 | automated | (a) staged suite with no `node_modules`, package installed; (b) package uninstalled | `04-terminal.ps1` | (a) output contains `hello-pty`, exit 0; (b) exit 77 |
| X10 | Install test — node-pty loads | fault (missing module) | L2 | automated | installed package with its `node-pty` dir renamed | `01-install.ps1` / `01-install.sh` | FAIL naming `node-pty`; after restore, PASS |
| X11 | POSIX fixture health means HTTP 200 | fault (non-200) | L2 | automated | foreign listener on `127.0.0.1:8000` answering 503 on `ubuntu-latest` | `bash qa/tests/run-all.sh` | `ensure_server` treats it as unhealthy; `03-websocket.sh` reported `FAIL (fixture: server did not start)` |
| X12 | Cross-platform compatibility — pwsh 7 path | regression | ci | automated | BOM + `Invoke-Native` edits in `28-gateway-windows.ps1` | PR triggers `ci-gateway-platform.yml` | workflow green |
| X13 | Cross-platform compatibility — PS 5.1 parse + run of a CI-only script | regression | L2 | automated | `28-gateway-windows.ps1` on the PS 5.1 host | `powershell -NoProfile -ExecutionPolicy Bypass -File 28-gateway-windows.ps1` (with `QA_REPO_ROOT` = a checkout) | no `NativeCommandError`; same verdict as the pwsh 7 CI run |
| M1 | Packer Windows/Linux/macOS flow on real VMware images | real hardware | — | manual-only | built Packer images on a VMware Fusion host | `make -C qa test-windows`, `test-linux-x86`, `test-macos-arm` | [judgment: needs licensed VMware + images; no CI equivalent] |

---

## Coverage summary

- Requirements covered: 15/15 delta requirements; each has ≥ 1 row. The `electron-qa-coverage` server-log rule is covered through E24, X1 and P1/E11.
- Scenarios by class: edge 25 · perf 1 · frontend 0 (no UI) · error 13 (incl. 1 manual)
- Scenarios by level: L1 4 · L2 34 · ci 1 · manual 1
- Scenarios by disposition: automated 39 · manual-only 1

## New infra needed

- `qa/tests/00-qa-common-selftest.ps1`: L2 self-test for `_qa-common.ps1` (E4–E10), first entry in `run-all.ps1`.
- A throwaway-branch `windows-latest` / `windows-11-arm` / `ubuntu-latest` / `macos-latest` verification workflow, reusing `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml`, plus stub `vm-*.sh`, `ssh` and `scp` for E18–E20. Lives only on the throwaway branch; not merged.
