# Tasks — add-macos-electron-launch-smoke

> DRAFT. Sequenced so the launch net exists before any Electron-major / Node 24 bump.

## 1. New test script

- [x] 1.1 Create `qa/tests/09-electron-mac-launch.sh`, cloning `08-electron-real-launch.sh` structure (artifact resolution, poll loop, process-tree cleanup trap, skip-clean exit 0).
- [x] 1.2 Resolve `.app` from `packages/electron/out/` (forge package output) first; fall back to the mounted DMG path the floor-check step already attaches.
- [x] 1.3 Launch via direct exec of the inner Mach-O (NOT `open`); omit `--no-sandbox`. NOTE: real binary is `Contents/MacOS/pi-dashboard` (`executableName` in forge.config.ts), not `…/PI Dashboard` as the spec text said; resolved by name with a fallback to the single executable in `Contents/MacOS/`.
- [x] 1.4 Defensive `xattr -dr com.apple.quarantine` when the bundle is copied from a DMG.
- [x] 1.5 Wipe `~/.pi/dashboard/server.log` before launch.
- [x] 1.6 Assert the four-point healthy-launch contract: health 200 ≤90 s, `starter==Electron`, server.log size>0, no `FATAL`.
- [x] 1.7 Header comment states boot-proof-not-floor-proof limitation + points to the `otool minos` static check.

## 2. CI wiring

- [x] 2.1 Add a `Launch-smoke the .app` step to the macOS legs of `.github/workflows/_electron-build.yml`, after "Verify deployment target floor", `if: matrix.platform == 'darwin'`.
- [x] 2.2 Confirm each leg execs its own arch (`macos-14`/arm64, `macos-15-intel`/x64) — no cross-arch exec.
- [x] 2.3 On failure, dump Electron stdout/stderr + `server.log` tail (mirror the Windows smoke's diagnostics).

## 3. Verify

- [x] 3.1 Trigger a macOS build leg; confirm the new step runs, launches, and goes green on both arches. DEFERRED to live CI run on the PR (needs `npm run make` on a GitHub-hosted macOS runner).
- [x] 3.2 Negative check: temporarily break the bundled-server spawn locally and confirm the smoke fails with an actionable message (not a silent skip). DEFERRED to the PR CI run.
- [x] 3.3 Confirm skip-clean path (exit 0) when `.app` absent on a PR run without `make`. Verified locally: prints `SKIP: .app missing …`, exit 0.

## 4. Docs

- [x] 4.1 Add `qa/tests/09-electron-mac-launch.sh` row to the file index (path-alphabetical, caveman style, delegated to a docs subagent). NOTE: `qa/tests/*` rows live in `docs/file-index-skills-misc.md`, not `docs/file-index-electron.md`; row added there before the `10-faux-model.sh` row.
- [x] 4.2 Note the new in-CI macOS launch coverage + the floor-proof gap in `docs/electron-session.md` test-matrix section (CI Workflow section).
