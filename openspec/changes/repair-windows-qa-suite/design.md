## Context

The VM suites run through `qa/scripts/run-test.sh`: it clones a Packer VM, scp's `qa/tests/` and runs `run-all.{sh,ps1}` (`qa/scripts/run-test.sh:44,78-81`). No workflow invokes either runner. The only `qa/tests` scripts CI runs are `windows-nsis-*` (`.github/workflows/_electron-build.yml:983-986`) and `28-gateway-windows.ps1` (`.github/workflows/ci-gateway-platform.yml:84`), both under pwsh 7.

**Baseline evidence.** The `automate-windows-remote-qa` spike ran `run-all.ps1` over sshd on `windows-latest` under Windows PowerShell 5.1.26100, with v0.10.0, BOM-fixed scripts and `01` patched. Result: 3 pass / 12 fail / 1 precondition-skip. Per-test output is preserved in `openspec/changes/automate-windows-remote-qa/spike/r2-run-all-over-ssh.txt`, and the result lines in `…/spike/r2-results.txt` (`R9.summary`).

| Test | Spike result + message | Class |
|---|---|---|
| 01 | PASS | (C3-exposed at `:14`) |
| 02 | FAIL "This command cannot be run due to the error: %1 is not a valid Win32 application." | C2 |
| 03, 04, 05, 22 | FAIL "Server not running (The operation has timed out.)" | C1 (+F7) |
| 07 | FAIL "offline cacache manifest missing at …\\resources\\offline-packages\\manifest.json" | C4 |
| 09 | PASS | (C3-exposed at `:24` — passes only while npm prints nothing to stderr) |
| 10 | FAIL "Server not running (Unable to connect to the remote server)" | C1 |
| 12 | "PASS", but printed "SKIP: pinned openspec bin not installed" | C5 |
| 16 | FAIL "Health endpoint did not respond HTTP 200 within 30s" + "Dashboard server is not running" | C2 (+F7) |
| 32 | FAIL "dashboard never started" | C2 (+F7) |
| 35 | FAIL; run-all caught the exception "npm warn deprecated inflight@1.0.6 …" | C3 |
| 38 | FAIL "Server not running (health request failed)" | C1 → expected skip (see D1) |
| 40 | precondition-skip (no checkout) | — (already correct) |
| 44 | FAIL; run-all caught the exception "usage: pi-photocraft <command> [args]" | C3 |

`12-keeper-log-rotation`, `17` and `45` are **not** in `run-all.ps1` (`:4-21`). They did not run, so they are latent defects, not baseline failures.

### Root causes (verified against source and the spike output above)

- **C1 — no shared server.** `03`/`04`/`05`/`10`/`22`/`38` and `17` probe `/api/health` and fail without a running server (`03-websocket.ps1:6-15`, `04-terminal.ps1:6-16`, `05-git-ops.ps1:6-16`, `10-bundled-git.ps1:13-23`, `22-worktree-separator.ps1:15-21`, `38-poll-cost.ps1:21-26`, `17-bridge-contention.ps1:15-18`). Nothing provides one: `02` stops its own in `finally` (`02-server-start.ps1:175-177`), and its POSIX twin uses `trap cleanup EXIT` (`02-server-start.sh:31-39`), while POSIX `03-websocket.sh:11` says "started by previous test". Present since `a80a720cb` (2026-04-13).
  - *Contributing* **F7** (dependency): the PS 5.1 `localhost` probes pay ~2 s for IPv6 and time out at 2–3 s. That is fixed by `automate-windows-remote-qa` (`127.0.0.1` rewrite + guard), a prerequisite here, not in scope.
- **C2 — bare `pi-dashboard` passed to `Start-Process`.** The npm prefix holds `pi-dashboard` (sh), `pi-dashboard.cmd` and `pi-dashboard.ps1` (spike `which` → `.ps1`; `r2-results.txt` `R8.inSession`). Two symptoms:
  - **with** `-RedirectStandardOutput`, PS uses CreateProcess on a non-PE file → "%1 is not a valid Win32 application" (`02:9`);
  - **without** redirection, ShellExecute does not run the CLI → "Dashboard server is not running" / "never started" (`16:23`, `32:43-45`).

  Calls through `& pi-dashboard api …` run the `.ps1` shim in-process and do start node (spike `R8`: install + `start` + `status` worked inside a `-File` script).
- **C3 — PS 5.1 turns redirected native stderr into a terminating error under `$ErrorActionPreference='Stop'`.** In Windows PowerShell 5.1, redirecting a native command's stderr (`2>&1`, `2>$null`, `*>`) wraps each stderr line in an `ErrorRecord`, and `Stop` throws on the first one. pwsh 7.2+ does not do this. The evidence: `35` and `44` were reported with the **stderr text** as the caught exception, not as an exit-code FAIL.

  A scan of `qa/tests/*.ps1` files that set `Stop` finds 36 redirect sites (re-scanned 2026-10-30 after `encrypt-credentials-at-rest` and `slim-windows-install-file-count` landed):
  - 7 are deliberate single-line `try { … } catch { }` no-ops, which are safe: `02:107,155,177`, `12-keeper-log-rotation:73`, `16:21,61`, `35:48`;
  - 1 is a deliberate exemption: `windows-nsis-upgrade.ps1:72` (`gh release download … 2>&1`) runs only under pwsh 7 in CI, where redirected native stderr is not an error record, and needs `gh` + `GH_TOKEN`;
  - **28 are exposed**, enumerated in tasks 2.2.
- **C4 — `07` asserts a removed layout.**
  - offline cache (`07-electron-bootstrap-v2.ps1:57-62`) and `~/.pi-dashboard` runtime install (`:136-160`): both removed by archived `eliminate-electron-runtime-install` (2026-05-26). Spike R4 snapshot diff: an Electron launch creates no `.pi-dashboard`.
  - `$Health.starter` (`:129-130`): removed (`openspec/specs/dashboard-starter-identity/spec.md` "Legacy starter field is absent"; spike `starter=null`, `launchSource=electron`).
  - x64-only zip name (`:17`) and `Expand-Archive` (`:37`, ≈12 min in PS 5.1).
  - Its health probe tries port 8000 first, then its own 8112 (`:19-20,96-100`), so any server already on 8000 (the fixture, an earlier test) answers instead of the Electron app.
- **C5 — precondition-unaware tests.** (Also: `12` finds bash via bare `Get-Command bash` (`12-openspec-shim.ps1:15`), which matches the WSL launcher `C:\Windows\System32\bash.exe` on hosts that have it, e.g. `windows-latest`.) Each of these prints `SKIP:`, then `exit 0`, which `run-all.ps1:51` counts as PASS:
  - `12-openspec-shim.ps1:16-18` (no Git Bash) and `:26-29` (no openspec bin);
  - `32-origin-gate.ps1:19-22` (CLI not on PATH);
  - `07:24-28` (no zip).

  Checkout-dependent tests resolve the repo inconsistently:
  - `12-keeper-log-rotation.ps1:18-22` and `17-bridge-contention.ps1:75`: `$PSScriptRoot\..\..`, and they exit 1 without it;
  - `45-windows-reclaim-refused.ps1:21`: `$env:QA_REPO_ROOT`, else the **cwd**;
  - `40-agent-path-gate-windows.ps1:16-24`: `$env:PI_DASHBOARD_REPO` with a marker `packages\extension\src\path-gate`, exit 77;
  - `QA_REPO_ROOT` is also read by `28-gateway-windows.ps1:38` and `35-plugin-install-load.ps1:288`.

**Not a cause — auth.** `requireLocalProof` defaults to true (`docs/faq.md` "Why do control routes 403"), but the bare `GET`s these tests use are observe-tier. `routeTier()` (`packages/shared/src/route-tiers.ts:549`) evaluated: `/api/git/branches`, `/api/git/worktrees`, `/api/tools/:name` and `/api/sessions` → `observe`. The `operate` `POST`s (`/api/terminals`, `/api/config`, `/api/ws-ticket`) already go through `pi-dashboard api`, which mints proof (`04:19-22`, `10:36-37`, `32:64`).

## Goals / Non-Goals

**Goals:**
- Through `make -C qa test-windows-remote-zip` / `…-npm` (dependency harness) on a stock Windows PowerShell 5.1 host **provisioned with the suite's tools** (Node ≥ 22.19 + npm, Git for Windows, internet access — the same set `qa/packer/scripts/provision-windows.ps1:39-53` installs; the harness preflight enforces the first three, dependency D2), every test PASSes except the **expected precondition-skips**:
  - with no repo checkout: `12`, `12-keeper-log-rotation`, `17`, `40`, `45`;
  - `38`: the fixture's server is not bridge-started;
  - `54` (no checkout) and `55` (non-interactive SSH session);
- npm mode only: `07` (no zip) and `10` (bundled git exists only under an Electron-launched server, `packages/shared/src/platform/ensure-bundled-git.ts:54-66`).

  `03`/`04`/`05`/`22` need **both** this change's fixture (C1) and the dependency's `127.0.0.1` rewrite (F7).
- The same fixture fixes the POSIX `run-all.sh` chain.
- One Windows execution path: the Packer flow reuses `qa/remote`.

**Non-Goals:**
- Full WebSocket-upgrade coverage (a real WS handshake on 9999 and a proof-minted browser WS on 8000) and an API-driven terminal-output check. The `test-execution` WebSocket and Terminal requirements are MODIFIED to state what the tests verify (D10), and the stronger coverage is filed as a follow-up issue (tasks 7.1).
- Making `38` pass under the runner (it needs a bridge-started server).
- Offline hosts: `09`/`44` exit 1 without registry access and a checkout; network is a harness precondition.
- POSIX tests beyond the fixture and `01-install.sh`.
- CI wiring of the VM suites.

## Decisions

### D1. Runner-owned shared-server fixture + explicit classification
`run-all.ps1` replaces its string list with `@{ Name; NeedsServer }` entries:

| Entry | NeedsServer | Own lifecycle / precondition |
|---|---|---|
| `01-install` | — | |
| `02-server-start` | — | starts and stops its own |
| `03-websocket`, `04-terminal`, `05-git-ops` | ✓ | |
| `07-electron-bootstrap-v2` | — | stops any dashboard first (D4); 77 without a zip |
| `09-image-fit-extension` | — | |
| `10-bundled-git` | ✓ | 77 unless `launchSource == "electron"` (D3) |
| `12-openspec-shim` | — | 77 without Git Bash / openspec bin |
| `12-keeper-log-rotation` (new in list) | — | 77 without a checkout |
| `16-windows-path-casing` | — | starts and stops its own on 8000 |
| `17-bridge-contention` (new in list) | ✓ | 77 without a checkout |
| `22-worktree-separator` | ✓ | |
| `32-origin-gate` | — | own server on 18870/19870 |
| `35-plugin-install-load` | — | own server on its own port |
| `40-agent-path-gate-windows` | — | 77 without a checkout |
| `54-credential-guard-windows` (added by `encrypt-credentials-at-rest`) | — | 77 without a checkout or `tsx` (already compliant) |
| `55-keychain-windows` (added by `encrypt-credentials-at-rest`) | — | own server on 18341 with an isolated `HOME`; 77 in a non-interactive session (every SSH session) unless `PI_QA_ALLOW_NONINTERACTIVE=1` |
| `38-poll-cost` | ✓ | expected 77 (not bridge-started) |
| `44-photocraft` | — | |
| `45-windows-reclaim-refused` (new in list) | — | 77 without a checkout |

The runner sets `$global:LASTEXITCODE = 0` before each entry, so a script that ends without `exit` can't inherit a stale code (`run-all.ps1:51` reads `$LASTEXITCODE`).

Before each ✓ entry, `Ensure-DashboardServer` runs:
- if `GET http://127.0.0.1:8000/api/health` answers 200 — and, when `QA_FIXTURE_EXE` is set, also reports `launchSource == "electron"` — nothing happens. A healthy server of the wrong kind in Electron fixture mode is stopped (`pi-dashboard stop`) and replaced;
- otherwise:
  1. record the current length of `~\.pi\dashboard\server.log` (0 if absent);
  2. launch:
     - when `QA_FIXTURE_EXE` is set (harness zip mode, dependency D4), `Start-Process` that `pi-dashboard.exe`, so the Electron app spawns the server;
     - else `Start-PiDashboard` (the npm CLI);
  3. wait ≤ 60 s;
  4. assert the log grew (`Assert-ServerLogGrew`; satisfies `electron-qa-coverage` "QA asserts server-log non-empty", without being fooled by an earlier test's log);
  5. log `fixture: started server (pid <health.pid>, launchSource <health.launchSource>)`.

If the fixture fails, the entry is recorded as `FAIL <name> (fixture: server did not start)` and not executed. After the loop the runner stops the server: `pi-dashboard stop`, plus, in Electron fixture mode, `Stop-Process -Name pi-dashboard`. Self-stopping tests (`02`, `07`, `16`, `35`) are harmless, because the next ✓ entry restarts the server.

`run-all.sh` mirrors this in **bash 3.2** (stock macOS `/bin/bash`; no `declare -A`, no `mapfile`):
- a space-separated `NEEDS_SERVER` list, matched with `case " $NEEDS_SERVER " in *" $test "*)`;
- `ensure_server()`: healthy means `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/health` prints `200`; otherwise `pi-dashboard start`, poll the same check for ≤ 60 s, then check log growth;
- the existing end-of-suite `pi-dashboard stop` (`run-all.sh:90`) is kept.

The list's members are the scripts that probe health without starting a server, found by grep and reviewed (tasks 3.2).

Checkout needs are **not** declared in the runners: each checkout-dependent test resolves its own precondition and exits 77 (D3).

*Rejected:* every test starting and stopping its own server. That means ~7 extra cycles of up to 15 s each, duplicated code, and a divergence from the scripts' stated contract.

### D2. `qa/tests/_qa-common.ps1` (dot-sourced helper, UTF-8 BOM, PS 5.1-safe)
- `Get-PiDashboardExe` → `(Get-Command pi-dashboard -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source`. This excludes `ExternalScript` (`.ps1`), and the extensionless sh file is not in `PATHEXT`, so the result is `pi-dashboard.cmd`. It returns `$null` when absent.
- `Start-PiDashboard [-ArgumentList <string[]>] [-RedirectStandardOutput <path>]`:
  - builds `$inner = '"' + $exe + '" ' + (($ArgumentList | ForEach-Object { '"' + $_ + '"' }) -join ' ')`, quoting each argument individually;
  - runs `Start-Process -FilePath $env:ComSpec -ArgumentList '/d','/s','/c', ('"' + $inner + '"') -WindowStyle Hidden -PassThru [-RedirectStandardOutput …]`. That is the outer-quoted `/s /c ""exe" "arg"…"` form, which is safe for paths with spaces (`cmd /?` quote rule).

  It returns the `cmd.exe` process object **for waiting only**: it exits when the CLI returns after daemonizing the server (`02:26-27` `WaitForExit` keeps working). Its PID is not the server's. Callers:
  - read the real PID from the CLI's own `Dashboard server started (pid N)` line (redirected stdout) or from `/api/health.pid`;
  - stop with `pi-dashboard stop [--port N]` (`packages/server/src/cli.ts:13`), never `Stop-Process` on the launcher's PID. Applies to `02:176`, `16:62-64`, and `32` `Cleanup` (`:27-29` → `stop --port $port`).
- `Wait-DashboardHealth -Port -TimeoutSec` → polls `http://127.0.0.1:<port>/api/health`; returns the health object or `$null`.
- `Assert-ServerLogGrew -Path -Before` → fails unless `Path` exists and its length > `Before`.
- `Invoke-Native -ScriptBlock { … }` → `$global:LASTEXITCODE = 0`, then saves `$ErrorActionPreference`, sets it to `Continue` and runs `$items = & $ScriptBlock` in `try`, restoring the preference in `finally`. Each **call site keeps its own redirection inside the block** (`{ npm install … 2>&1 }`), because redirection on the block invocation does not reach native calls inside it. Stdin is provided by piping inside the block (`{ $mcpIn | & $pc mcp --root $work 2>&1 }`); the block is a closure over the caller's variables, so there is no `-InputObject`. It returns `[pscustomobject]@{ ExitCode = $LASTEXITCODE; Stdout; Stderr; Text }`:
  - `Stdout` = the non-`ErrorRecord` items as `[string[]]`;
  - `Stderr` = the `ErrorRecord` items as `[string[]]`;
  - `Text` = all items as one string, in order, joined by newlines.

  Sites that `-match` a single string (`02:36,46`) use `.Text`; JSON parsing (`44:69`) uses `.Stdout`.
- `Resolve-RepoCheckout -Marker <relative path>` → the first of `$env:PI_DASHBOARD_REPO`, `$env:QA_REPO_ROOT` (kept for existing consumers) and `$PSScriptRoot\..\..` that contains `-Marker`. Returns `$null` otherwise. It never falls back to the cwd.
- `Get-GitBash` → the shell pi itself would resolve, in the order `openspec/specs/windows-git-bash-runtime/spec.md` "Active git/bash source is observable via API and UI" defines:
  1. `%ProgramFiles%\Git\bin\bash.exe`;
  2. `%ProgramFiles(x86)%\Git\bin\bash.exe`;
  3. the first `bash.exe` on PATH that is not `%SystemRoot%\System32\bash.exe` (the WSL launcher).

  It returns `$null` when none exists. `12` thereby tests the shim under the same shell the bash tool would use.

Consumers dot-source it with `. (Join-Path $PSScriptRoot '_qa-common.ps1')`. It is staged with the suite because the harness copies the whole `qa/tests/` tree (`automate-windows-remote-qa` D3). The leading `_` keeps it out of the runner list.

### D3. Exit 77 = precondition not met (Windows runner)
`run-all.ps1` already maps 77 to precondition-skipped, which does not fail the suite (`run-all.ps1:51-58`). Every `SKIP:`/`exit 0` path in a script **listed in `run-all.ps1`** becomes `exit 77` (77 means something only to that runner). `windows-nsis-*.ps1` are run by CI (`_electron-build.yml`, which fails the step on any nonzero exit) and by the harness's nsis mode, so they keep `SKIP:` + exit 0 (`windows-nsis-upgrade.ps1:66-67`, no previous release). The paths that change:
- `07` (no zip);
- `12` (no `Get-GitBash`; no openspec bin);
- `32` (no CLI).

New preconditions:
- `10` → 77 when `/api/health.launchSource -ne "electron"` (bundled git exists only in the Electron bundle);
- `44` gains an explicit final `exit 0`.

`Resolve-RepoCheckout` markers (77 on `$null`):

| Test | Marker |
|---|---|
| `12-openspec-shim` | `node_modules\@fission-ai\openspec\bin\openspec.js` |
| `12-keeper-log-rotation` | `packages\server\src\rpc-keeper\keeper.cjs` |
| `17` | `node_modules\ws` |
| `40` | `packages\extension\src\path-gate` |
| `45` | `packages\server\src\spawn-process\session-terminator.ts` (imported at `45:44`) |
| `28` | its existing resolution, minus the cwd fallback (`28:5,38`); CI sets `QA_REPO_ROOT` (`ci-gateway-platform.yml:83`) |

`35` is **not** checkout-dependent: it installs from the registry (`35:34-35,145,163`), and its `QA_REPO_ROOT` use (`35:288`) is an optional contamination probe. It stays as is. Separately, `35` puts `$prefix\bin` on PATH (`35:43-45`), but a Windows npm `--prefix` install puts its shims directly in `$prefix` (spike `R8`: `C:\npm\prefix\pi-dashboard.ps1`). On Windows it prepends `$prefix`, so it runs its own isolated install.

The POSIX runner keeps its existing `SKIP:` first-line + exit 0 convention (`run-all.sh:78-79`; `10-faux-model.sh:11-16`). The 77 rule is scoped to the Windows runner and is **not** imposed on `.sh` scripts.

### D4. `07` rewrite (current bundle)
1. Pick the zip **first**, so the skip path has no side effects:
   - arch = `$env:PROCESSOR_ARCHITEW6432`, else `$env:PROCESSOR_ARCHITECTURE` (WOW64-safe); `AMD64` → `x64`, `ARM64` → `arm64`;
   - take `C:\qa-artifacts\PI-Dashboard-win32-<arch>.zip`;
   - exit 77 when it is absent. The dependency stages zips by basename.
2. Stop **our** dashboards only:
   - `pi-dashboard stop` and `pi-dashboard stop --port 8112` via `Invoke-Native`;
   - `Stop-Process -Name pi-dashboard` (the Electron app's own image name, as `07` does today, `07:31-32`).

   If ports 8000 or 8112 are still held, FAIL naming the owning process. Foreign listeners are never killed.
3. `Remove-Item` the extract dir, then `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory(<zip>, <dir>)`. That API does not overwrite, hence the wipe.
4. Locate the nested `PI-Dashboard-win32-*` root (`07:39-40`). Relative to it, assert `resources\server\node_modules\@blackbelt-technology\pi-dashboard-server\src\cli.ts` and `resources\node\node.exe` (`openspec/specs/electron-launch-source/spec.md` "Windows resources layout resolves to bundled Node").
5. Record the `server.log` length, launch `pi-dashboard.exe`, and wait ≤ 180 s for `/api/health` on `127.0.0.1:8000`.
6. Assert `launchSource == "electron"` and `Assert-ServerLogGrew`.
7. A stopwatch around steps 3–5 fails the test above **600 s** (the agreed budget; `Expand-Archive` took ≈12 min in the spike). Its measured seconds are always printed. The full suite's wall clock is recorded in `summary.json` only, with no threshold.

The offline-cache, managed-dir and `starter` assertions are dropped. Over the harness the test runs headless in session 0; the spike shows Electron serves health there in ~10 s (dependency F6). This is an **additional** automated run of `07`. It does not claim to replace `electron-build-pipeline`'s launch validation "on a VM with a desktop session", which stays an operator step. Revisiting that requirement on the session-0 evidence is `automate-windows-remote-qa` task 7.2a.

### D5. PS 5.1 native-stderr sweep
All **23** exposed sites (tasks 2.2) go through `Invoke-Native`, keeping their redirection inside the block. The 7 single-line `try { … } catch { }` no-ops stay. There is no static guard for this class: a line heuristic cannot tell a native from a PowerShell call, or a multi-line `try` (cycle-1 findings). Regressions are caught by the PS 5.1 host run (tasks §6), which executes every script.

### D6. Packer flow delegates to the harness
In the `windows*` branch of `qa/scripts/run-test.sh`, after `vm-wait-ssh.sh`:
- `KH=$(mktemp)`;
- `rc=0; qa/remote/run.sh --host "$VM_IP" --user "$SSH_USER" --key "$SSH_KEY" --known-hosts "$KH" <mode args> || rc=$?`, so `set -e` (`run-test.sh:4`) cannot skip the summary;
- `<mode args>` = `--mode zip --artifact "$ELECTRON_ZIP"` when the zip exists, else `--mode npm --npm-version "${QA_NPM_VERSION:-latest}"`;
- the existing generic `scp -r qa/tests` and `pack-fixture-plugin.mjs` uploads (`run-test.sh:44,48`) move inside the non-Windows branch, so the POSIX flow is byte-identical;
- `rm -f "$KH"` in the existing trap;
- `exit $rc`.

The flags belong to the harness (`automate-windows-remote-qa` D7, amended): identity regexes, plus `--known-hosts`, which keeps `accept-new` while avoiding stale entries for recycled VM IPs. Packer images set `DefaultShell=powershell.exe` (`qa/packer/scripts/provision-windows.ps1:65`); the harness preflight auto-selects the suffixed form (dependency D2).

### D7. Install tests take a pinnable spec
`01-install.sh` (`:12,26`) installs `${QA_NPM_SPEC:-@blackbelt-technology/pi-agent-dashboard}` and derives the package directory it checks from the spec's name part. This is the POSIX twin of the dependency's `01-install.ps1` change. When the spec carries an exact version (`@x.y.z`), both `01` scripts assert `pi-dashboard --version` equals it (spec "Pinned install").

### D8. Server-log assertion on every spawning test
`02`, `16`, `32` and `35` spawn a server and confirm health but never assert the log (`electron-qa-coverage` "QA asserts server-log non-empty after a successful spawn"). Each records the log length before its start and calls `Assert-ServerLogGrew` after health. `32` uses its own `$qaHome\.pi\dashboard\server.log` (`32:39-41` overrides `USERPROFILE`). `02` additionally asserts that its captured start-stdout file (`$start1Out`) is non-empty: that is the requirement's "per-test stdout file" for non-Electron paths.

### D9. `04` resolves node-pty from the installed package
`04` pipes its check into `node -` (`04-terminal.ps1:54`), which resolves `require('node-pty')` from the cwd. The harness staging dir has no `node_modules`. `04` sets `NODE_PATH` to the installed package's module dirs:
- `$(npm root -g)\@blackbelt-technology\pi-agent-dashboard\node_modules`;
- the nested `…\node_modules\@blackbelt-technology\pi-dashboard-server\node_modules`.

`node-pty` is a `pi-dashboard-server` dependency (`packages/server/package.json:105`). `04` exits 77 when the package dir is absent.

### D10. Spec honesty for the base `test-execution` requirements
Tests are tightened where cheap, and the spec text is MODIFIED where the test is the honest contract:
- **Git operations:** `05` FAILs when `GET /api/git/branches` fails or returns no branch. Its local `git branch` fallback (`05-git-ops.ps1:39-55`) is removed.
- **Install:** both `01` scripts `require('node-pty')` from the installed package (D9's `NODE_PATH`) and FAIL if it does not load. That covers "native module compilation" for a prebuilt or compiled binary.
- **Server start:** spec MODIFIED to `GET http://127.0.0.1:8000/api/health` → 200 within **15** s, which is what `02` enforces (`02:14-18`).
- **WebSocket:** spec MODIFIED to TCP reachability of the pi gateway (9999) and the dashboard port (8000), which is what `03` verifies. `03`'s Node probe connects to `127.0.0.1`, not `localhost` (`03-websocket.ps1:24`), removing any IPv6 dependence (spike `R4`: `[::1]:8000` refused). A full WS-upgrade check is a follow-up issue.
- **Terminal (Windows):** spec MODIFIED to "a terminal session is created via the API, and node-pty spawns PowerShell through ConPTY and receives its output". That is what `04` verifies (`04-terminal.ps1:19-29,54`). An API-driven output check is a follow-up issue.

## Risks / Trade-offs

- **The fixture can mask an unexpected server stop by a test.** → A test that needs the server stopped asserts it itself, and every restart is logged with its `launchSource`.
- **Electron fixture (zip mode) startup** is slower than the CLI (spike: ~10 s). → It stays within the 60 s fixture budget.
- **`Get-Command -CommandType Application` resolution** on non-npm installs may yield another `.cmd`. → Same intent: an executable, not a script. Verified for the npm layout in §6.
- **`Invoke-Native` relies on per-site redirection.** A site that forgets `2>&1` inside the block keeps the 5.1 behaviour. → It is caught by the §6 PS 5.1 run, and the review checklist in tasks 2.2 names the rule.
- **POSIX `03+` start executing** and may reveal hidden POSIX failures. → Intended: they are reported, not fixed here.
- **No static C3 guard.** → Accepted (D5).

## Migration Plan

Test-only. It lands after `automate-windows-remote-qa` (`dependencies.yaml`). Rollback: revert the `qa/` edits.

## Open Questions

None blocking. Whether POSIX `03+` pass on Linux/macOS once they run is observed in §6.
