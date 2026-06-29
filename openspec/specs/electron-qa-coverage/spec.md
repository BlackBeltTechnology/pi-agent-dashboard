# electron-qa-coverage Specification

## Purpose
Defines the QA coverage required to catch Electron-bootstrap regressions — particularly the failure modes observed in v0.4.6 (degraded managed `node_modules`, invisible server logs, and lack of a real Electron-launch smoke test on Linux). These requirements pin specific QA stages and tests so production regressions are caught by the CI/VM test suite before release.
## Requirements
### Requirement: QA simulates degraded managed-dir recovery
The Linux Docker installer test (`packages/electron/scripts/test-electron-install-inner.sh`) SHALL include a "degraded re-extract recovery" stage that runs after the happy-path installation and health check succeed. This stage SHALL prove that the bootstrap auto-recovers when the `.version` marker says "no extraction needed" but the actual managed `node_modules` tree is degraded — the failure mode that produced the user-visible "FATAL: Cannot find pi's TypeScript loader (jiti)" in v0.4.6.

#### Scenario: Stage 9 wipes critical subtree and re-runs install
- **WHEN** Stage 9 of `test-electron-install-inner.sh` runs
- **THEN** the script SHALL stop the previously-spawned server, wipe `$MANAGED_DIR/node_modules/@mariozechner` (which contains jiti), and assert that subtree is gone (precondition: degraded state)
- **AND** the script SHALL re-invoke the installation logic that mirrors `installStandalone` (`npm install --prefix --cache <offline>` + node_modules merge)
- **AND** SHALL assert `$MANAGED_DIR/node_modules/@mariozechner/jiti` exists post-recovery (recovery succeeded)
- **AND** SHALL re-spawn the server and re-assert `/api/health` returns 200

#### Scenario: Stage 9 fails when production fix is reverted
- **WHEN** the production code is regressed by removing `extractedSourceIsHealthy` wiring (or its bash-script counterpart)
- **THEN** Stage 9 SHALL fail with a clear message identifying the missing recovery (`jiti not restored after re-install attempt` or similar)

### Requirement: QA asserts server-log non-empty after a successful spawn
Every QA test that successfully spawns the dashboard server and confirms `/api/health` SHALL also assert that the server's persistent log file (`~/.pi/dashboard/server.log` for the Electron-managed path; per-test stdout file for non-Electron paths) is non-empty. A 0-byte log after a healthy spawn indicates the kind of stdio-routing bug that produced the v0.4.6 invisible-server-log regression and SHALL be treated as a test failure.

#### Scenario: 02-server-start.sh asserts log non-empty
- **WHEN** `qa/tests/02-server-start.sh` confirms `/api/health` returns 200
- **THEN** the test SHALL assert the server's captured stdout file (e.g. `/tmp/pi-server-stdout.log`) is non-empty
- **AND** SHALL fail with a clear message if the file is empty or missing

#### Scenario: 07-electron-bootstrap-v2.ps1 asserts log non-empty
- **WHEN** the Windows VM test confirms the dashboard window opened and `/api/health` succeeded
- **THEN** the test SHALL assert `${env:USERPROFILE}\.pi\dashboard\server.log` exists AND has length > 0
- **AND** SHALL fail with a message such as "FAIL: ~/.pi/dashboard/server.log empty after successful spawn — likely spawnDetached stdio regression"

### Requirement: Linux Electron headless smoke exercises the real main process
A new test `qa/tests/08-electron-real-launch.sh` SHALL launch the packaged Electron AppImage under `xvfb-run` on the Linux QA VM and SHALL assert (a) the main process reaches a healthy server, (b) the server-spawned log is non-empty, and (c) no `FATAL` substring appears in the Electron parent's combined stdout/stderr. This is the only QA path that exercises `selectLaunchSource` + `spawnFromSource` + `spawnDetached` end-to-end on a non-Windows host.

#### Scenario: Healthy AppImage launch
- **WHEN** `xvfb-run "$APPIMAGE" --no-sandbox` is executed inside the Ubuntu QA VM
- **THEN** within 120 seconds `curl http://localhost:8000/api/health` SHALL return HTTP 200 with JSON containing `"launchSource":"electron"`
- **AND** `~/.pi/dashboard/server.log` SHALL exist with size > 0
- **AND** the Electron parent's combined output SHALL NOT contain the substring `FATAL`

#### Scenario: AppImage absent — skip cleanly
- **WHEN** `08-electron-real-launch.sh` runs without the AppImage artifact present
- **THEN** the test SHALL exit 0 with a clear "skipped — AppImage missing, run `npm run make` first" message
- **AND** SHALL NOT be counted as a failure in `run-all.sh`'s pass/fail total

#### Scenario: xvfb missing on the QA VM
- **WHEN** `08-electron-real-launch.sh` runs on a VM without `xvfb-run` on PATH
- **THEN** the test SHALL fail with an actionable message pointing to the provisioning script that should install xvfb
- **AND** SHALL NOT silently skip (xvfb is a required prerequisite, not an optional artifact)

### Requirement: macOS Electron launch smoke exercises the real main process in CI
A new test `qa/tests/09-electron-mac-launch.sh` SHALL launch the packaged macOS `.app` directly (executing `…/Contents/MacOS/PI Dashboard`, NOT via `open`) and SHALL assert (a) the main process reaches a healthy server, (b) the server-spawned log is non-empty, and (c) no `FATAL` substring appears in the Electron parent's combined stdout/stderr. The test SHALL be invoked from the macOS legs of `_electron-build.yml` after the deployment-target floor check, running in-job on the GitHub-hosted macOS runner (which provides a real WindowServer session). Each macOS leg's runner arch SHALL match its binary arch (`macos-14`→arm64, `macos-15-intel`→x64), so the runner execs its own native binary. This is the only QA path that exercises `selectLaunchSource` + `spawnFromSource` + `spawnDetached` end-to-end on macOS.

#### Scenario: Healthy .app launch
- **WHEN** `…/Contents/MacOS/PI Dashboard` is executed on the GitHub-hosted macOS runner
- **THEN** within 120 seconds `curl http://localhost:8000/api/health` SHALL return HTTP 200 with JSON containing `"launchSource":"electron"`
- **AND** `~/.pi/dashboard/server.log` SHALL exist with size > 0
- **AND** the Electron parent's combined output SHALL NOT contain the substring `FATAL`

#### Scenario: Launch uses direct exec, never `open`
- **WHEN** the test launches the app
- **THEN** it SHALL invoke the inner Mach-O binary at `…/Contents/MacOS/PI Dashboard` directly
- **AND** SHALL NOT use macOS `open`, because `open` drops env/args to the bundle and yields an unobservable process (per `docs/electron-session.md` Phase 5)

#### Scenario: Quarantine attribute stripped when copied from DMG
- **WHEN** the `.app` is resolved by copying from a mounted DMG rather than from the `out/` tree
- **THEN** the test SHALL `xattr -dr com.apple.quarantine` the copied bundle before launch
- **AND** Gatekeeper SHALL NOT block the launch

#### Scenario: server.log wiped before launch
- **WHEN** the test begins
- **THEN** it SHALL remove any pre-existing `~/.pi/dashboard/server.log`
- **AND** the non-empty assertion SHALL therefore reflect only this run's output

#### Scenario: .app absent — skip cleanly
- **WHEN** `09-electron-mac-launch.sh` runs without the packaged `.app` present (e.g. a PR run without `npm run make`)
- **THEN** the test SHALL exit 0 with a clear "skipped — .app missing, run `npm run make` first" message
- **AND** SHALL NOT be counted as a failure

#### Scenario: Electron exits before health responds
- **WHEN** the launched Electron process exits before `/api/health` returns 200
- **THEN** the test SHALL fail with a message identifying early exit
- **AND** SHALL dump the last lines of the Electron stdout/stderr for diagnosis

### Requirement: macOS launch smoke is documented as boot-proof, not floor-proof
The macOS launch smoke SHALL be documented (proposal + test header comment) as proving the binary BOOTS on the runner's macOS version, NOT that it boots on the advertised minimum macOS floor. The runner OS (macOS 14/15) is above the floor; floor-proof verification on the oldest allowed macOS remains a separate, unimplemented QA gap.

#### Scenario: Test header states the limitation
- **WHEN** a reader opens `qa/tests/09-electron-mac-launch.sh`
- **THEN** the header comment SHALL state that the test proves boot on the runner's macOS version only
- **AND** SHALL point to the static `otool minos` floor assertion as the complementary (label-only) floor check

