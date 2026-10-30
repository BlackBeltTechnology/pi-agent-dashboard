## Why

The cross-platform VM suites (`qa/tests/run-all.ps1`, `qa/tests/run-all.sh`) cannot pass, and no CI workflow runs them, so the rot went unseen.

The 2026-10-25 spike ran `run-all.ps1` over stock sshd on `windows-latest` (Windows PowerShell 5.1) against v0.10.0, with scripts BOM-fixed and `01` given the right npm name. Result: **3 pass / 12 fail / 1 precondition-skip**. Per-test output: `openspec/changes/automate-windows-remote-qa/spike/r2-run-all-over-ssh.txt`. The per-test table and root causes are in this change's design.md.

Five root-cause classes explain every failure:

1. **No shared server.** `03`/`04`/`05`/`10`/`22`/`38` (and never-run `17`) need a running server, but `02` stops its own on exit and nothing else starts one. Broken since the suite was created (`a80a720cb`, 2026-04-13), identically in `run-all.sh`. The PS 5.1 `localhost` probe penalty (dependency F7) aggravates it.
2. **Bare `pi-dashboard` passed to `Start-Process`.** It resolves to the npm `.ps1` shim. With output redirection → "%1 is not a valid Win32 application" (`02`); without it → the CLI silently never runs (`16`, `32`).
3. **PS 5.1 turns redirected native stderr into a terminating error under `$ErrorActionPreference='Stop'`.** `35` died on an npm deprecation warning, `44` on `pi-photocraft --help` usage text (both caught as exceptions carrying the stderr text — not a wrong CLI call, as the seed claimed). 23 exposed call sites.
4. **`07` asserts a removed layout:** the offline cache and the `~/.pi-dashboard` runtime install (removed 2026-05-26 by `eliminate-electron-runtime-install`), and the removed `/api/health.starter` field. It also hard-codes the x64 zip, collides with any server on port 8000, and spends ≈12 min in PS 5.1 `Expand-Archive`.
5. **Precondition-unaware tests.** `07`/`12`/`32` print `SKIP:` and exit 0, which counts as PASS. The checkout-dependent `12-keeper-log-rotation`, `17` and `45` resolve the repo inconsistently (`45` falls back to the cwd), exit 1 without one, and are not even listed in `run-all.ps1`.

Auth is **not** a cause. Every bare `GET` used is observe-tier (`packages/shared/src/route-tiers.ts` `routeTier`), and every `POST` goes through `pi-dashboard api`, which mints local proof.

## What Changes

- **Server fixture in both runners.** `run-all.ps1` declares `@{ Name; NeedsServer }` per test; the full classification table is in design D1. Before every `NeedsServer` test, the runner ensures `127.0.0.1:8000` is healthy. When an earlier test stopped the server, it starts one:
  - the **deployed Electron app** when `QA_FIXTURE_EXE` is set (harness zip mode);
  - the npm CLI otherwise.

  It asserts `server.log` grew, and stops the server after the suite. A fixture failure marks the dependent test `FAIL (fixture)` without running it. The runner also resets `$LASTEXITCODE` per test. `run-all.sh` gets the same pattern in bash-3.2-compatible form.
- **Shared PS helper** `qa/tests/_qa-common.ps1` (dot-sourced, never listed as a test):
  - `Get-PiDashboardExe` → the `.cmd` shim;
  - `Start-PiDashboard` → through `cmd.exe /d /s /c ""exe" args"`, so redirection works and paths with spaces survive; servers are stopped with `pi-dashboard stop [--port]`, never by PID;
  - `Wait-DashboardHealth` (`127.0.0.1`) and `Assert-ServerLogGrew`;
  - `Invoke-Native` → EAP `Continue` in `try/finally`, `LASTEXITCODE` reset; returns `{ ExitCode, Stdout, Stderr, Text }`; each site keeps its own `2>&1` and any stdin pipe inside the block;
  - `Resolve-RepoCheckout -Marker` → `PI_DASHBOARD_REPO`, then `QA_REPO_ROOT`, then the grandparent; never the cwd;
  - `Get-GitBash` → Git for Windows' `bash.exe`, never the WSL launcher.
- **C2:** `02`, `16` and `32` launch through `Start-PiDashboard`; `32` stops its server with `pi-dashboard stop --port`.
- **Server-log assertions** in `02`, `16`, `32` and `35` (`electron-qa-coverage` "QA asserts server-log non-empty after a successful spawn", which these spawning tests did not satisfy).
- **`04`** loads `node-pty` from the installed dashboard package (`NODE_PATH`), not from the staging dir.
- **Spec honesty (design D10):**
  - `05` fails when the branch API fails, with no local `git` fallback;
  - both `01` scripts load `node-pty` from the installed package;
  - `03`'s Node probe targets `127.0.0.1`;
  - the `test-execution` Server-start (127.0.0.1, 15 s), WebSocket (TCP reachability) and Windows Terminal (API create + node-pty ConPTY output) requirements are MODIFIED to what the tests verify. Full WS-upgrade and API-driven terminal-output coverage goes to a follow-up issue.
- **`35`** prepends its Windows npm `--prefix` dir (where npm puts the shims) to PATH instead of `$prefix\bin`, so it runs its own isolated install.
- **C3:** all 23 exposed redirected native calls go through `Invoke-Native`. The 7 single-line `try{}catch{}` no-ops stay.
- **`07` rewritten** to the current bundle:
  - zip chosen by host architecture (WOW64-safe) **before** any side effect;
  - stop our own dashboards (ports 8000 and 8112), but never kill a foreign listener — FAIL naming it instead;
  - wipe the extract dir, then `ZipFile` extraction;
  - assertions: bundled server CLI + `resources\node\node.exe`, `launchSource == "electron"`, non-empty `server.log`;
  - exit 77 without a zip.
- **Exit 77 on Windows:**
  - `07` (no zip), `12` (no openspec bin / Git Bash), `32` (no CLI);
  - `10` (server not Electron-launched, so no bundled git);
  - `12-keeper-log-rotation`, `17`, `40` and `45` (no checkout, via `Resolve-RepoCheckout`); `28` loses its cwd fallback;
  - `44` gains an explicit `exit 0`;
  - `12-keeper-log-rotation`, `17` and `45` are added to `run-all.ps1`.

  The POSIX `SKIP:` first-line convention is unchanged.
- **`01-install.sh`** installs `$QA_NPM_SPEC`, defaulting to `@blackbelt-technology/pi-agent-dashboard`. This is the POSIX twin of the dependency's `01-install.ps1` fix. Both `01` scripts assert `--version` equals a pinned version when the spec carries one.
- **The `qa/scripts/run-test.sh` Windows branch** delegates to `qa/remote/run.sh --host/--user/--key --known-hosts <mktemp>`: zip mode when a zip is present, npm mode otherwise. The identity flags and `--known-hosts` are owned and validated by `automate-windows-remote-qa` (amended D7). No host-key relaxation: `accept-new` stays, and only the file is per-run.
- **Spec:** `test-execution` corrected (npm package name, fixture semantics, Windows exit-77 convention, Windows execution through `qa/remote`, CLI launch, native stderr, current-bundle ZIP e2e, Packer delegation).

**Expected result over the harness** (on a host provisioned with Node ≥ 22.19 + npm, Git for Windows and internet access; the harness preflight enforces the tools): every test PASSes except the precondition-skips:
- `12`, `12-keeper-log-rotation`, `17`, `40`, `45` (no checkout on a harness host);
- `38` (needs a bridge-started server);
- npm mode only: `07` (no zip) and `10` (no Electron-launched server).

`03`/`04`/`05`/`22` additionally depend on the dependency's `127.0.0.1` probe rewrite (F7).

**Non-goals:** full WS-upgrade and API-driven terminal-output coverage (follow-up issue); making `38` pass under the runner; offline hosts; POSIX tests beyond the fixture and `01-install.sh`; CI wiring of the VM suites.

## Capabilities

### Modified Capabilities

- `test-execution`: install test names the real package and loads node-pty; Server-start / WebSocket / Terminal / Git requirements match what the tests verify; runner owns a shared-server fixture; Windows exit-77 convention; Windows tests execute through the `qa/remote` harness; CLI launched as an executable; native stderr tolerated; Windows ZIP e2e asserts the current bundle; Packer Windows flow delegates to the harness. (`electron-qa-coverage`'s server-log requirement becomes satisfied by every spawning Windows test: `07`, the fixture, `02`, `16`, `32` and `35`.)

## Impact

- **Code (`qa/`, plus one test file under `packages/`):**
  - `qa/tests/_qa-common.ps1` (new);
  - `qa/tests/01-install.ps1`, `02`, `03`, `04`, `05`, `07`, `09`, `10`, `12-openspec-shim`, `12-keeper-log-rotation`, `16`, `17`, `22`, `28-gateway-windows`, `32`, `35`, `40`, `44`, `45`, `run-all.ps1` (and the `07` sidecar `AGENTS.md`);
  - `qa/tests/01-install.sh`, `qa/tests/run-all.sh`;
  - `qa/scripts/run-test.sh`;
  - the `qa/README.md` and `AGENTS.md` rows (`qa/tests`, `qa/scripts`);
  - `packages/shared/src/__tests__/qa-windows-ps1-compat.test.ts` (extended).

  No production code, no workflow files.
- **CI touched indirectly:** `28-gateway-windows.ps1` runs in the path-filtered `ci-gateway-platform.yml` under pwsh 7. `Invoke-Native` is neutral there; that workflow verifies it.
- **Depends on** `automate-windows-remote-qa` (`dependencies.yaml`): it provides the harness and its identity/`--known-hosts` flags, BOM + `127.0.0.1` load-compat, `QA_NPM_SPEC` in `01-install.ps1`, zip staging by basename, `QA_NPM_SPEC`/`QA_FIXTURE_EXE` in zip mode, and the guard test extended here.
- **POSIX:** `run-all.sh` gains the fixture. `make test-linux-*`/`test-macos-*` change from always-failing `03+` to running them.
- **Rollback:** revert the `qa/` edits. No runtime state is involved.

## Discipline Skills

- `systematic-debugging` — each failing script was root-caused before planning (five classes above); implementation re-verifies each class on a real PS 5.1 host before and after the fix.
- `review-code` — before commit.

None of `security-hardening`, `performance-optimization`, `observability-instrumentation` or `doubt-driven-review` applies: test-only code, no auth surface, no irreversible step. The only ssh-policy-adjacent piece (`--known-hosts` per run) is specified and validated in `automate-windows-remote-qa`, under its `security-hardening` discipline.
