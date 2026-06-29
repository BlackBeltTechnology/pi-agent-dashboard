# Tasks — add-macos-electron-launch-smoke

> DRAFT. Sequenced so the launch net exists before any Electron-major / Node 24 bump.

## 1. New test script

- [ ] 1.1 Create `qa/tests/09-electron-mac-launch.sh`, cloning `08-electron-real-launch.sh` structure (artifact resolution, poll loop, process-tree cleanup trap, skip-clean exit 0).
- [ ] 1.2 Resolve `.app` from `packages/electron/out/` (forge package output) first; fall back to the mounted DMG path the floor-check step already attaches.
- [ ] 1.3 Launch via direct exec of `…/Contents/MacOS/PI Dashboard` (NOT `open`); omit `--no-sandbox`.
- [ ] 1.4 Defensive `xattr -dr com.apple.quarantine` when the bundle is copied from a DMG.
- [ ] 1.5 Wipe `~/.pi/dashboard/server.log` before launch.
- [ ] 1.6 Assert the four-point healthy-launch contract: health 200 ≤90 s, `starter==Electron`, server.log size>0, no `FATAL`.
- [ ] 1.7 Header comment states boot-proof-not-floor-proof limitation + points to the `otool minos` static check.

## 2. CI wiring

- [ ] 2.1 Add a `Launch-smoke the .app` step to the macOS legs of `.github/workflows/_electron-build.yml`, after "Verify deployment target floor", `if: matrix.platform == 'darwin'`.
- [ ] 2.2 Confirm each leg execs its own arch (`macos-14`/arm64, `macos-15-intel`/x64) — no cross-arch exec.
- [ ] 2.3 On failure, dump Electron stdout/stderr + `server.log` tail (mirror the Windows smoke's diagnostics).

## 3. Verify

- [ ] 3.1 Trigger a macOS build leg; confirm the new step runs, launches, and goes green on both arches.
- [ ] 3.2 Negative check: temporarily break the bundled-server spawn locally and confirm the smoke fails with an actionable message (not a silent skip).
- [ ] 3.3 Confirm skip-clean path (exit 0) when `.app` absent on a PR run without `make`.

## 4. Docs

- [ ] 4.1 Add `qa/tests/09-electron-mac-launch.sh` row to `docs/file-index-electron.md` (path-alphabetical, caveman style, delegated to a docs subagent).
- [ ] 4.2 Note the new in-CI macOS launch coverage + the floor-proof gap in `docs/electron-session.md` test-matrix section.
