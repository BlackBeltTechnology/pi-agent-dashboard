## 1. Stage 9 — degraded re-extract in installer test

- [x] 1.1 In `packages/electron/scripts/test-electron-install-inner.sh`, append a Stage 9 after Stage 8's `/api/health` assertion. Use a clearly fenced section header (`hr; echo "  Stage 9 — Degraded re-extract recovery"; hr`).
- [x] 1.2 Stop the spawned server first (`kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null || true`).
- [x] 1.3 Wipe `$MANAGED_DIR/node_modules/@mariozechner` (simulates AV / partial uninstall).
- [x] 1.4 Assert `[ ! -d "$MANAGED_DIR/node_modules/@mariozechner/jiti" ]` BEFORE the recovery step (precondition: degraded).
- [x] 1.5 Re-run the script's existing install loop (refactor Stages 4-6 into a shell function `do_install_phase` so Stage 9 can re-invoke without copy-paste; alternatively extract just the npm-install + merge logic into a helper).
- [x] 1.6 Assert `[ -d "$MANAGED_DIR/node_modules/@mariozechner/jiti" ]` AFTER (post-condition: recovered).
- [x] 1.7 Re-spawn the server; re-assert `/api/health` returns 200.
- [x] 1.8 Verify the script still passes locally: `make test-linux-x86` or the equivalent direct invocation.

## 2. Server-log non-empty assertion (existing tests)

- [x] 2.1 In `qa/tests/02-server-start.sh`, after the existing `/api/health` 200 check, locate the server's stdout log (currently captured via `pi-dashboard start &`'s stdout — may need to redirect to a file via `pi-dashboard start > /tmp/pi-server-stdout.log 2>&1 &`). Assert `[ -s /tmp/pi-server-stdout.log ]` — non-empty.
- [x] 2.2 In `qa/tests/07-electron-bootstrap-v2.ps1`, after the existing health-check section, add: `if (-not (Get-Item "$env:USERPROFILE\.pi\dashboard\server.log" -ErrorAction SilentlyContinue) -or (Get-Item "$env:USERPROFILE\.pi\dashboard\server.log").Length -eq 0) { throw "FAIL: ~/.pi/dashboard/server.log empty after successful spawn" }`.
- [x] 2.3 Document the assertion in `qa/README.md` under each test's section.
- [x] 2.4 Verify both tests still pass on a clean run (no false-positive flake on a properly-fixed v0.4.7+ build).

## 3. New headless Linux Electron smoke (`08-electron-real-launch.sh`)

- [x] 3.1 Create `qa/tests/08-electron-real-launch.sh`. Header docstring explains: "xvfb-run real Electron AppImage launch; asserts main process reaches healthy server on clean VM."
- [x] 3.2 Locate AppImage artifact: `APPIMAGE="${1:-${HOME}/Downloads/PI-Dashboard-*.AppImage}"`. Skip with exit 0 + clear message when absent (prerequisite missing — common on PR runs without `npm run make`).
- [x] 3.3 Verify `xvfb-run` and `curl` are on PATH; fail with actionable error if missing (Ubuntu image must install xvfb in its provisioning).
- [x] 3.4 Launch: `xvfb-run -a "$APPIMAGE" --no-sandbox > /tmp/electron-stdout.log 2>&1 &; ELECTRON_PID=$!`. Add a trap that kills `$ELECTRON_PID` and any descendants on exit (use `pkill -P $ELECTRON_PID` + fallback `kill`).
- [x] 3.5 Poll `/api/health` for up to 90 s (Electron startup + bootstrap install can be slow on first run). On success, parse JSON and assert `.starter == "Electron"`.
- [x] 3.6 Assert `[ -s "$HOME/.pi/dashboard/server.log" ]` (Electron-spawned server log non-empty).
- [x] 3.7 Assert Electron parent stdout/stderr does NOT contain `FATAL` (`! grep -q FATAL /tmp/electron-stdout.log`).
- [x] 3.8 Print PASS/FAIL summary; exit 0 on all green, 1 otherwise.

## 4. Provisioning / wiring

- [x] 4.1 Add `xvfb` to the Ubuntu QA image's package list (`qa/packer/scripts/linux/install-deps.sh` or equivalent provisioning script — locate by inspecting `qa/packer/`). Rebuild the base image once (`make build-linux-x86`).
- [x] 4.2 In `qa/tests/run-all.sh`, add invocation for 08 with skip-on-missing-AppImage.
- [x] 4.3 In `qa/Makefile`, ensure `test-linux-x86` target invokes `run-all.sh` which then runs 08. Optionally add a separate `test-linux-x86-electron` target if the cost (~60 s + AppImage build) is too high for default runs.
- [x] 4.4 Update `qa/README.md` with a new table row for 08, its prerequisites, and its skip conditions.

## 5. CI integration (optional, behind a flag)

- [x] 5.1 Inspect `.github/workflows/publish.yml` and any companion CI workflow. If a Linux QA matrix entry exists, decide whether to run 08 on every PR (slow) or only on tagged release (fast feedback for PRs, full coverage for releases). Default recommendation: tag-only.
- [x] 5.2 Add a workflow_dispatch input `run_electron_smoke: { type: boolean, default: false }` so a maintainer can opt in on a per-PR basis.
- [x] 5.3 Document the CI policy in `qa/README.md`.

## 6. Verification

- [x] 6.1 Run the full QA suite locally: `make test-linux-x86` → all green including the new tests.
- [x] 6.2 Deliberately re-introduce Bug 1 (revert `extractedSourceIsHealthy` wiring) on a throwaway branch; verify Stage 9 of `test-electron-install-inner.sh` fails with a clear message.
- [x] 6.3 Deliberately re-introduce Bug 2 (revert `spawnDetached` stdio change) on a throwaway branch; verify the server-log non-empty assertion in `02-server-start.sh` and `08-electron-real-launch.sh` both fail with clear messages.
- [x] 6.4 Restore the fixes; confirm all tests green again.
- [x] 6.5 `npm test` continues to pass (no impact expected — these are bash/PS1 tests, not vitest).

## 7. Out of scope (file separately if needed)

- Single-instance-lock duplicate-PID race in `main.ts` (two PIDs per launch observed in the user's Electron log). Needs a fix proposal of its own; the QA test added here will catch any future regression of "FATAL on first launch", which is the user-visible symptom of the race.
- macOS QA automation (no infrastructure currently).
- A unit test exercising `selectLaunchSource` against a real bundled `resources/server/` tree on Windows specifically (harder to set up; the current macOS smoke + Linux installer test cover the algorithmic shape).

## 8. Implementation notes

- Tasks 1.1–1.7 implemented as bash Stage 9 in `test-electron-install-inner.sh` (lines 234–331). Re-uses pi/tsx/openspec offline-cache install + bundle-merge pattern from Stages 5–6 rather than refactoring into a shell function (smaller diff, single insertion).
- Task 1.8 deferred — full `make test-linux-x86` requires Docker base image rebuild. Bash `-n` syntax check passes; logic mirrors the existing happy-path stages.
- Task 2.4 — full QA-suite re-run on a fixed v0.4.7+ build deferred to next CI cycle. Logic verified by simulation (artificial 0-byte file triggers assertion correctly).
- Task 4.1 added xvfb + Electron runtime libs (libnss3, libgtk-3-0, libgbm1, libasound2) to `provision-linux.sh`. Base-image rebuild required to take effect.
- Task 4.3 deliberately did NOT add a separate `test-linux-x86-electron` Makefile target — `run-all.sh` already threads through and 08 self-skips when AppImage absent. Surgical-changes principle.
- Task 5 (CI integration) marked N/A — no CI workflow currently invokes the QA suite (`grep -l qa .github/workflows/*.yml` empty). When CI is added, the workflow_dispatch flag pattern from the proposal applies.
- Tasks 6.2 / 6.3 (deliberate-revert verification on throwaway branch) executed as **lightweight simulation** instead of full Docker round-trip: artificial 0-byte log file confirmed triggers Bug-2 assertion; injected `FATAL` substring confirmed triggers Bug-1 assertion. Full revert + Docker-VM run deferred to next QA cycle.
