## 1. Guard test + shared helper (TDD)

- [ ] 1.1 Extend `packages/shared/src/__tests__/qa-windows-ps1-compat.test.ts` (from `automate-windows-remote-qa`) with:
  - (a) no `Start-Process` whose `-FilePath` is the bare string `pi-dashboard` in `qa/tests/*.ps1`;
  - (b) `run-all.ps1` lists `12-keeper-log-rotation.ps1`, `17-bridge-contention.ps1` and `45-windows-reclaim-refused.ps1`, and every listed entry exists on disk;
  - (c) no `qa/tests/*.ps1` has a `SKIP:` line followed by `exit 0` within the next 3 lines;

  Run it and see it FAIL on today's tree (design C2/C5).
- [ ] 1.2 Write `qa/tests/_qa-common.ps1` (UTF-8 BOM, PS 5.1-safe) per design D2:
  - `Get-PiDashboardExe`;
  - `Start-PiDashboard` (each `-ArgumentList` item quoted; `$env:ComSpec /d /s /c ""exe" "arg"…"`; optional `-RedirectStandardOutput`; returns the cmd process for **waiting only**);
  - `Wait-DashboardHealth` (127.0.0.1) and `Assert-ServerLogGrew`;
  - `Invoke-Native` (`LASTEXITCODE` reset, EAP `Continue` in `try/finally`; returns `ExitCode`/`Stdout`/`Stderr`/`Text`);
  - `Resolve-RepoCheckout -Marker` (`PI_DASHBOARD_REPO` → `QA_REPO_ROOT` → grandparent; never the cwd);
  - `Get-GitBash` (the `windows-git-bash-runtime` resolution order, design D2; never `System32\bash.exe`).

## 2. Root-cause fixes

- [ ] 2.1 C2 (design D2):
  - `02:9` (keeps its stdout capture via `-RedirectStandardOutput`), `16:23` and `32:43` launch through `Start-PiDashboard`;
  - replace the `Stop-Process $proc.Id` cleanups (`02` finally, `16` finally, `32` `Cleanup`) with `pi-dashboard stop` (`--port $port` in `32`); `02:26-27` keeps `WaitForExit` on the returned cmd process;
  - `02`'s B:-drive relaunch keeps `node <wrapper>`.
- [ ] 2.2 C3 (design D5): route each of the 23 exposed sites through `Invoke-Native`. The redirection stays **inside** the block, and so does stdin (`44:69` → `{ $mcpIn | & $pc mcp --root $work 2>&1 }`). Judge by `.ExitCode`; use `.Text` where a single string is matched (`02:36,46`) and `.Stdout` where output is parsed. Sites:
  - `01:14`; `02:36,46,116,157`; `04:22`; `09:24`;
  - `10:67,80`; `12-openspec-shim:47`; `22:82`;
  - `28:199,270`; `32:64`;
  - `35:53,136,145,163,181`;
  - `44:23,42,69`; `45:65`.

  Leave the 7 single-line `try { … } catch { }` no-ops. Re-run the design C3 scan before editing, and fold any new site into this list.
- [ ] 2.3 C4: rewrite `07-electron-bootstrap-v2.ps1` per design D4:
  - zip chosen first (WOW64-safe arch; 77 with no side effect);
  - stop our dashboards on 8000/8112, and FAIL naming any foreign holder without killing it;
  - wipe, then `Add-Type -AssemblyName System.IO.Compression.FileSystem` + `ZipFile`;
  - assertions relative to the nested root: bundled server CLI, `resources\node\node.exe`, `launchSource`, `Assert-ServerLogGrew`;
  - exit 77 without a zip;
  - a 600 s stopwatch over extract + launch + health; FAIL above it, always print the seconds.

  Re-sync `07-electron-bootstrap-v2.ps1.AGENTS.md`.
- [ ] 2.4 C5 + preconditions (design D3):
  - exit 77 for `12-openspec-shim` (no `Get-GitBash`; no bin via `Resolve-RepoCheckout`) and `32` (no CLI);
  - `10` exits 77 unless `launchSource == "electron"`;
  - `12-keeper-log-rotation`, `17`, `40` and `45` use `Resolve-RepoCheckout` with the D3 markers and exit 77 on `$null`;
  - `28` drops its cwd fallback;
  - `35` prepends its npm `--prefix` dir (not `$prefix\bin`) to PATH on Windows (`35:43-45`);
  - `44` ends with `exit 0`.
- [ ] 2.5 D7: `01-install.sh` installs `${QA_NPM_SPEC:-@blackbelt-technology/pi-agent-dashboard}` and derives the package dir it checks (`:26`) from the spec's name. When the spec has an exact version, both `01-install.sh` and `01-install.ps1` assert that `pi-dashboard --version` equals it.
- [ ] 2.6 D8: `02`, `16`, `32` and `35` record the `server.log` length before their own start and call `Assert-ServerLogGrew` after health. `32` uses its `$qaHome` log path.
- [ ] 2.6b D10:
  - `05` FAILs when `GET /api/git/branches` fails or returns no branch (drop the local `git branch` fallback, `05:39-55`);
  - both `01` scripts `require('node-pty')` via the D9 `NODE_PATH` and FAIL if it does not load;
  - `03`'s Node probe connects to `127.0.0.1` on 9999 and 8000.
- [ ] 2.7 D9: `04` sets `NODE_PATH` from `npm root -g` (the package's `node_modules` + the nested `pi-dashboard-server\node_modules`) before `node -`, and exits 77 when the package is not installed.

## 3. Runners

- [ ] 3.1 `run-all.ps1` (design D1):
  - the classification table, with the new `00-qa-common-selftest.ps1` (helper self-tests, test-plan E4–E10) as the first entry;
  - `$global:LASTEXITCODE = 0` before each entry;
  - `Ensure-DashboardServer`: health on 127.0.0.1:8000. With `QA_FIXTURE_EXE` set, it also requires `launchSource == "electron"`, stopping and replacing a server of the wrong kind. Otherwise it launches `QA_FIXTURE_EXE` when set, else `Start-PiDashboard`; ≤60 s; `Assert-ServerLogGrew`; log the pid + `launchSource`;
  - a fixture failure → `FAIL <name> (fixture: server did not start)` without running the test;
  - stop at the end (`pi-dashboard stop`; plus `Stop-Process -Name pi-dashboard` in Electron fixture mode).
- [ ] 3.2 `run-all.sh`, bash 3.2 only:
  - a space-separated `NEEDS_SERVER` list (`grep -l 'Server not running' qa/tests/*.sh` minus scripts that start their own server, reviewed by hand);
  - `ensure_server()` (healthy = `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/health` prints `200`; `pi-dashboard start`; ≤60 s; log growth);
  - the same fixture-FAIL attribution;
  - keep the existing `SKIP:` first-line rule and the end-of-suite `pi-dashboard stop` (`run-all.sh:90`).

## 4. Packer flow → harness

- [ ] 4.1 `qa/scripts/run-test.sh` `windows*` branch (design D6):
  - `KH=$(mktemp)`;
  - `rc=0; qa/remote/run.sh --host "$VM_IP" --user "$SSH_USER" --key "$SSH_KEY" --known-hosts "$KH" … || rc=$?`, with `--mode zip --artifact "$ELECTRON_ZIP"` when the zip exists, else `--mode npm --npm-version "${QA_NPM_VERSION:-latest}"`;
  - `rm -f "$KH"` in the trap;
  - `exit $rc`;
  - move the generic `scp -r qa/tests` + `pack-fixture-plugin.mjs` uploads (`:44,48`) inside the non-Windows branch, so the POSIX flow is byte-identical;
  - delete the Windows-only `C:/qa-artifacts` upload and the `powershell -File /tmp/qa-tests/run-all.ps1` call.

## 5. Docs + DOX

- [ ] 5.1 `qa/README.md`: the fixture (CLI vs `QA_FIXTURE_EXE`), the Windows exit-77 convention, `PI_DASHBOARD_REPO`/`QA_REPO_ROOT`, the expected precondition-skip list per mode, and that `make test-windows` now runs through `qa/remote`.
- [ ] 5.2 Update the `qa/tests/AGENTS.md` rows (new `_qa-common.ps1`; every edited test; `run-all.ps1`; `run-all.sh`; `01-install.sh`) and the `qa/scripts/AGENTS.md` `run-test.sh` row.

## 6. Tests (folded from test-plan.md) + validation

- [ ] 6.0 `openspec validate repair-windows-qa-suite --strict`; `node scripts/check-conventions.mjs`; `npm test` green.
- [ ] 6.0a Verification infra (not merged): a throwaway branch carrying a workflow derived from `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml`, with jobs on `windows-latest`, `windows-11-arm`, `ubuntu-latest` and `macos-latest`, plus stub `vm-*.sh`/`ssh`/`scp` for the Packer-flow rows. Delete the branch afterwards; `git ls-remote --heads origin 'spike/*'` must be empty.

- [ ] 6.1 Level L1 — Windows scripts launch the CLI as an executable: see `packages/shared/src/__tests__/no-legacy-pi-fork.test.ts` (repo-level fs scan) and the dependency-created `qa-windows-ps1-compat.test.ts`. Triple — input: a `qa/tests/*.ps1` containing `Start-Process -FilePath "pi-dashboard"` · trigger: `npm test` runs `qa-windows-ps1-compat.test.ts` · observable: test fails naming file:line; passes on the fixed tree (test-plan #E1)
- [ ] 6.2 Level L1 — Exit 77 — never-run tests are listed: see `packages/shared/src/__tests__/no-legacy-pi-fork.test.ts` (repo-level fs scan) and the dependency-created `qa-windows-ps1-compat.test.ts`. Triple — input: `run-all.ps1` without `17-bridge-contention.ps1`, or listing a file that does not exist · trigger: `npm test` · observable: test fails naming the missing or nonexistent entry (test-plan #E2)
- [ ] 6.3 Level L1 — Exit 77 means precondition not met on Windows: see `packages/shared/src/__tests__/no-legacy-pi-fork.test.ts` (repo-level fs scan) and the dependency-created `qa-windows-ps1-compat.test.ts`. Triple — input: a `.ps1` with a `SKIP:` line followed by `exit 0` within 3 lines · trigger: `npm test` · observable: test fails naming file:line (test-plan #E3)
- [ ] 6.4 Level L2 — Shim resolution and quoting: add to `qa/tests/00-qa-common-selftest.ps1`; see `qa/tests/45-windows-reclaim-refused.ps1` for a self-contained Windows assertion script. Triple — input: temp PATH dir holding `pi-dashboard` (sh), `pi-dashboard.cmd`, `pi-dashboard.ps1` · trigger: `Get-PiDashboardExe` · observable: returns the `.cmd` path; returns `$null` when only the `.ps1` + sh exist (test-plan #E4)
- [ ] 6.5 Level L2 — Shim resolution and quoting: add to `qa/tests/00-qa-common-selftest.ps1`; see `qa/tests/45-windows-reclaim-refused.ps1` for a self-contained Windows assertion script. Triple — input: stub `C:\qa sp\pi-dashboard.cmd` that writes `%*` to a file; args `start`, `a b` · trigger: `Start-PiDashboard -ArgumentList start,'a b'` then `WaitForExit` · observable: file contains exactly `"start" "a b"`; the cmd process exits 0 (test-plan #E5)
- [ ] 6.6 Level L2 — Windows scripts tolerate native stderr under PowerShell 5.1: add to `qa/tests/00-qa-common-selftest.ps1`; see `qa/tests/45-windows-reclaim-refused.ps1` for a self-contained Windows assertion script. Triple — input: `$ErrorActionPreference='Stop'`; block `{ cmd /c "echo out & echo err 1>&2 & exit 3" 2>&1 }` · trigger: `Invoke-Native` · observable: no exception; `ExitCode` 3; `Stdout` = `out`; `Stderr` = `err`; `Text` has both, in order (test-plan #E6)
- [ ] 6.7 Level L2 — Output-consuming native call: add to `qa/tests/00-qa-common-selftest.ps1`; see `qa/tests/45-windows-reclaim-refused.ps1` for a self-contained Windows assertion script. Triple — input: `$in = 'ping'`; block `{ $in | node -e "process.stdin.pipe(process.stdout)" 2>&1 }` · trigger: `Invoke-Native` · observable: `Stdout` = `ping`, `ExitCode` 0 (test-plan #E7)
- [ ] 6.8 Level L2 — Windows scripts tolerate native stderr under PowerShell 5.1: add to `qa/tests/00-qa-common-selftest.ps1`; see `qa/tests/45-windows-reclaim-refused.ps1` for a self-contained Windows assertion script. Triple — input: a previous `cmd /c exit 5`; block with no native call `{ 'x' }` · trigger: `Invoke-Native` · observable: `ExitCode` 0, not 5 (test-plan #E8)
- [ ] 6.9 Level L2 — Checkout resolution order: add to `qa/tests/00-qa-common-selftest.ps1`; see `qa/tests/45-windows-reclaim-refused.ps1` for a self-contained Windows assertion script. Triple — input: cases: (a) `PI_DASHBOARD_REPO` lacks marker, `QA_REPO_ROOT` has it; (b) neither env var, cwd has marker, grandparent does not · trigger: `Resolve-RepoCheckout -Marker packages` · observable: (a) returns `QA_REPO_ROOT`; (b) returns `$null` (no cwd fallback) (test-plan #E9)
- [ ] 6.10 Level L2 — Missing openspec bin or Git Bash: add to `qa/tests/00-qa-common-selftest.ps1`; see `qa/tests/45-windows-reclaim-refused.ps1` for a self-contained Windows assertion script. Triple — input: PATH with `C:\Windows\System32` first (WSL `bash.exe` present on `windows-latest`) + Git for Windows installed · trigger: `Get-GitBash` · observable: returns `%ProgramFiles%\Git\bin\bash.exe` (the `windows-git-bash-runtime` order), never `System32\bash.exe`; with Git hidden (`ProgramFiles`/`ProgramFiles(x86)` → empty dirs, PATH trimmed to System32) returns `$null` (test-plan #E10)
- [ ] 6.11 Level L2 — Runner-owned fixture + expected skips (zip mode): see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: v0.10.0 zip, provisioned host, no checkout · trigger: `make -C qa test-windows-remote-zip` · observable: `summary.json.exitCode` 0; precondition-skipped = {12-openspec-shim, 12-keeper-log-rotation, 17, 40, 45, 38}; every other entry PASS (incl. 07, 10) (test-plan #E11)
- [ ] 6.12 Level L2 — Runner-owned fixture + expected skips (npm mode): see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: `npmVersion` 0.10.0, provisioned host, no checkout · trigger: `make -C qa test-windows-remote-npm` · observable: exit 0; precondition-skipped = E11 set ∪ {07, 10}; every other entry PASS (test-plan #E12)
- [ ] 6.13 Level L2 — Windows ZIP e2e — arm64 zip: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: `windows-11-arm` runner; both win32 zips in `C:\qa-artifacts` · trigger: run `07` directly · observable: log names `PI-Dashboard-win32-arm64.zip`; PASS with `launchSource=electron` (test-plan #E13)
- [ ] 6.14 Level L2 — Windows ZIP e2e — skip path has no side effects: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: no zip for host arch; fixture server healthy on 8000 · trigger: run `07` · observable: exit 77; `GET 127.0.0.1:8000/api/health` still 200 afterwards (test-plan #E14)
- [ ] 6.15 Level L2 — Install test — pinned install: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: `QA_NPM_SPEC=@blackbelt-technology/pi-agent-dashboard@0.10.0`; and separately `QA_NPM_SPEC` with no version · trigger: run `01-install.ps1` and `01-install.sh` · observable: pinned: prints `0.10.0` and PASSes; unpinned: no version assertion, PASS (test-plan #E15)
- [ ] 6.16 Level L2 — WebSocket connection test (127.0.0.1): see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: server listening on `127.0.0.1` only (fixture) · trigger: `03-websocket.ps1` · observable: prints `Pi gateway (9999): OK`, `Browser WS (8000): OK`; exit 0 (test-plan #E16)
- [ ] 6.17 Level L2 — Runner-owned fixture — POSIX parity, bash 3.2: see `qa/tests/02-server-start.sh` + `qa/tests/run-all.sh`, on a throwaway-branch `ubuntu-latest`/`macos-latest` job. Triple — input: `macos-latest` `/bin/bash` 3.2 and `ubuntu-latest` bash 5; npm-global install · trigger: `bash qa/tests/run-all.sh` · observable: `bash -n` clean on 3.2; `fixture: started server` precedes `03-websocket.sh`, which does not report "Server not running" (test-plan #E17)
- [ ] 6.18 Level L2 — Packer Windows flow runs through the remote harness: see `qa/scripts/run-test.sh` + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml`, with stub `vm-*.sh`/`ssh`/`scp` on PATH. Triple — input: stub `vm-clone.sh`/`vm-wait-ssh.sh`/`vm-destroy.sh` returning `127.0.0.1`; runner sshd; zip present · trigger: `qa/scripts/run-test.sh windows …` · observable: `run.sh` invoked with `--host 127.0.0.1 --known-hosts <tmp> --mode zip --artifact <zip>`; rc = driver rc; temp file removed (test-plan #E18)
- [ ] 6.19 Level L2 — Packer flow — POSIX branch unchanged: see `qa/scripts/run-test.sh` + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml`, with stub `vm-*.sh`/`ssh`/`scp` on PATH. Triple — input: stub `ssh`/`scp` that log argv; same stubs for vm scripts · trigger: `run-test.sh linux-x86 …` before and after the change · observable: identical logged `scp`/`ssh` argv sequence (test-plan #E19)
- [ ] 6.20 Level L2 — Packer flow — recycled VM IP with a new host key: see `qa/scripts/run-test.sh` + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml`, with stub `vm-*.sh`/`ssh`/`scp` on PATH. Triple — input: E18 setup; regenerate the runner's sshd host keys between runs · trigger: run E18 twice · observable: both runs succeed; `qa/remote/.known_hosts` unchanged (mtime + hash) (test-plan #E20)
- [ ] 6.21 Level L2 — Shim resolution and quoting — path with spaces: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: `npm config set prefix "C:\npm prefix"`; reinstall the package · trigger: run `02`, `16`, `32` · observable: each starts its server (health 200) and PASSes (test-plan #E21)
- [ ] 6.22 Level L2 — Windows fixture launches the artifact under test: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: zip mode (`QA_FIXTURE_EXE` set) vs npm mode (unset) · trigger: `10-bundled-git.ps1` within `run-all.ps1` · observable: zip: fixture logs `launchSource electron`, `10` PASSes its bundled-git assertions; npm: fixture logs `launchSource standalone`, `10` exits 77 (test-plan #E22)
- [ ] 6.23 Level L2 — Bridge-only test under the fixture: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: fixture standalone server · trigger: `38-poll-cost.ps1` · observable: exit 77; summary lists it under precondition-skipped (test-plan #E23)
- [ ] 6.24 Level L2 — First-start output is captured: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — input: clean host, npm install · trigger: `02-server-start.ps1` · observable: redirected start file contains `Dashboard server started (pid N)`; the second start prints `already running (pid N)` with the same N; `server.log` grew (test-plan #E24)
- [ ] 6.25 Level L1 — Git operations test — API failure is not masked: see `packages/shared/src/__tests__/no-legacy-pi-fork.test.ts` (repo-level fs scan) and the dependency-created `qa-windows-ps1-compat.test.ts`. Triple — input: `qa/tests/05-git-ops.ps1` · trigger: `npm test` · observable: no `git branch --list` fallback after a failed `/api/git/branches` call; the failure path exits 1 (test-plan #E25)
- [ ] 6.26 Level L2 — Windows ZIP e2e — time budget: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — workload: v0.10.0 x64 zip (388 MB) on the `windows-latest` PS 5.1 host · trigger: `07` stopwatch over extract + launch + health ≤ 600 s (FAIL above; seconds always printed) · observable: one `07` run (test-plan #P1)
- [ ] 6.27 Level L2 — Runner-owned fixture — after a self-stopping test: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: `02` stops the server on exit · trigger: `03` is next in `run-all.ps1` · observable: output shows `fixture: started server (pid N, launchSource …)` before `Running: 03-websocket.ps1`; `03` PASS (test-plan #X1)
- [ ] 6.28 Level L2 — Fixture failure is attributed, not cascaded: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: foreign `node` TCP server holding `127.0.0.1:8000` and answering 503 · trigger: run `run-all.ps1` · observable: `03`/`04`/`05`/`10`/`17`/`22`/`38` reported `FAIL <name> (fixture: server did not start)` without running; `01`/`09`/`44` still execute; suite rc 1 (test-plan #X2)
- [ ] 6.29 Level L2 — Stale log does not satisfy the fixture: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: `server.log` pre-filled; `QA_FIXTURE_EXE` = an exe that starts no server (`$env:ComSpec`) · trigger: fixture runs before `03` · observable: `03` reported `FAIL (fixture: server did not start)` (test-plan #X3)
- [ ] 6.30 Level L2 — Wrong kind of server in Electron fixture mode: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: standalone server running; `QA_FIXTURE_EXE` set · trigger: fixture before the next ✓ test · observable: fixture stops it; log line shows `launchSource electron`; health then reports `electron` (test-plan #X4)
- [ ] 6.31 Level L2 — Windows scripts tolerate native stderr — npm warnings: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: `npm install` writes `npm warn deprecated …` to stderr with rc 0 · trigger: `35-plugin-install-load.ps1` · observable: no exception at `:136`; the test continues to its own assertions and PASSes (test-plan #X5)
- [ ] 6.32 Level L2 — Usage text on stderr + output-consuming call: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: `pi-photocraft --help` prints usage to stderr; `mcp` logs to stderr · trigger: `44-photocraft.ps1` · observable: no exception at `:42`/`:69`; MCP `tools/list` parsed from stdout only; exit 0 (test-plan #X6)
- [ ] 6.33 Level L2 — Server on a custom port is stopped: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: `32` forced to fail after start (temporarily set `$body` to invalid JSON) and a normal run · trigger: `32-origin-gate.ps1` · observable: after both runs, `Get-NetTCPConnection -LocalPort 18870,19870` is empty (test-plan #X7)
- [ ] 6.34 Level L2 — Foreign listener is reported, not killed: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: foreign `node` listener on 8000 after `07`'s stop step · trigger: `07` · observable: `07` FAILs naming the process; that process is still alive afterwards (test-plan #X8)
- [ ] 6.35 Level L2 — Terminal test resolves node-pty from the installed dashboard: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: (a) staged suite with no `node_modules`, package installed; (b) package uninstalled · trigger: `04-terminal.ps1` · observable: (a) output contains `hello-pty`, exit 0; (b) exit 77 (test-plan #X9)
- [ ] 6.36 Level L2 — Install test — node-pty loads: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: installed package with its `node-pty` dir renamed · trigger: `01-install.ps1` / `01-install.sh` · observable: FAIL naming `node-pty`; after restore, PASS (test-plan #X10)
- [ ] 6.37 Level L2 — POSIX fixture health means HTTP 200: see `qa/tests/02-server-start.sh` + `qa/tests/run-all.sh`, on a throwaway-branch `ubuntu-latest`/`macos-latest` job. Triple — fault: foreign listener on `127.0.0.1:8000` answering 503 on `ubuntu-latest` · trigger: `bash qa/tests/run-all.sh` · observable: `ensure_server` treats it as unhealthy; `03-websocket.sh` reported `FAIL (fixture: server did not start)` (test-plan #X11)
- [ ] 6.38 Level ci — Cross-platform compatibility — pwsh 7 path: see `.github/workflows/ci-gateway-platform.yml`. Triple — fault: BOM + `Invoke-Native` edits in `28-gateway-windows.ps1` · trigger: PR triggers `ci-gateway-platform.yml` · observable: workflow green (test-plan #X12)
- [ ] 6.39 Level L2 — Cross-platform compatibility — PS 5.1 parse + run of a CI-only script: see `qa/tests/40-agent-path-gate-windows.ps1` (77 pattern) + `automate-windows-remote-qa/spike/spike-win-remote-qa.round2.yml` (self-ssh PS 5.1 host). Triple — fault: `28-gateway-windows.ps1` on the PS 5.1 host · trigger: `powershell -NoProfile -ExecutionPolicy Bypass -File 28-gateway-windows.ps1` (with `QA_REPO_ROOT` = a checkout) · observable: no `NativeCommandError`; same verdict as the pwsh 7 CI run (test-plan #X13)
- [ ] 6.40 Manual: Packer Windows/Linux/macOS flow on real VMware images — built Packer images on a VMware Fusion host · `make -C qa test-windows`, `test-linux-x86`, `test-macos-arm` · [judgment: needs licensed VMware + images; no CI equivalent] (test-plan: manual-only) (test-plan #M1)

## 7. Follow-ups

- [ ] 7.1 File one GitHub issue covering:
  - full WS-upgrade coverage (pi gateway 9999 + proof-minted browser WS 8000);
  - an API-driven terminal-output check;
  - any POSIX failures surfaced by 6.5.
