# electron-qa-coverage — delta

## ADDED Requirements

### Requirement: macOS Electron launch smoke exercises the real main process in CI
A new test `qa/tests/09-electron-mac-launch.sh` SHALL launch the packaged macOS `.app` directly (executing `…/Contents/MacOS/PI Dashboard`, NOT via `open`) and SHALL assert (a) the main process reaches a healthy server, (b) the server-spawned log is non-empty, and (c) no `FATAL` substring appears in the Electron parent's combined stdout/stderr. The test SHALL be invoked from the macOS legs of `_electron-build.yml` after the deployment-target floor check, running in-job on the GitHub-hosted macOS runner (which provides a real WindowServer session). Each macOS leg's runner arch SHALL match its binary arch (`macos-14`→arm64, `macos-15-intel`→x64), so the runner execs its own native binary. This is the only QA path that exercises `selectLaunchSource` + `spawnFromSource` + `spawnDetached` end-to-end on macOS.

#### Scenario: Healthy .app launch
- **WHEN** `…/Contents/MacOS/PI Dashboard` is executed on the GitHub-hosted macOS runner
- **THEN** within 90 seconds `curl http://localhost:8000/api/health` SHALL return HTTP 200 with JSON containing `"starter":"Electron"`
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
