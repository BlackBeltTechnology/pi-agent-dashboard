# Add a macOS Electron launch smoke (CI, in-job)

> **Status: DRAFT.** Captured from an explore-mode session on the Electron 32 → Node 24 question. Not yet scoped for implementation.

## Why

macOS is the only build leg with **no runtime launch test** — in CI *or* QA. CI's macOS coverage is build + a **static** `otool` `minos` assertion (`_electron-build.yml` "Verify deployment target floor"). That proves the binary is *labeled* for the right OS floor; it never proves the app *boots* or that the bundled server reaches `/api/health`.

- Linux has `qa/tests/08-electron-real-launch.sh` (xvfb, real launch) — but that runs on the manual VM layer, not GH Actions.
- Windows has `windows-nsis-launch.ps1` — also VM/manual; the CI smoke deliberately **skips** launch because GitHub Windows runners have no desktop session.
- macOS has nothing dynamic at all.

The unlock: **GitHub-hosted macOS runners (`macos-14`, `macos-15-intel`) have a real Aqua/WindowServer session** — unlike the headless Windows/Linux GH runners. So macOS, ironically the only platform with zero launch coverage, is the **only** platform where a real launch smoke can run **directly in the build job, on the same runner that produced the DMG, with no VM**.

This matters now because a Node 24 bump means jumping Electron 32 → 40 (eight majors, crossing the macOS Catalina/Big Sur/Monterey floors). The riskiest surface of that migration — *does the new Electron actually launch and bootstrap the bundled server on macOS* — is exactly what is currently untested. This smoke is the safety net that turns "we built a DMG and hope" into "CI confirms it boots."

## What Changes

- **Add one test** `qa/tests/09-electron-mac-launch.sh` modeled on `08-electron-real-launch.sh`, sharing the same four-assertion "healthy launch" contract:
  1. `/api/health` returns 200 within ~90 s,
  2. `health.starter == "Electron"`,
  3. `~/.pi/dashboard/server.log` is non-empty (stdio-routing regression net),
  4. no `FATAL` substring in the Electron parent's combined stdout/stderr.
- **macOS specifics** (where it differs from the Linux script):
  - Exec the inner Mach-O directly — `…/Contents/MacOS/PI Dashboard` — **never** `open` (macOS `open` drops env/args to the bundle; documented in `docs/electron-session.md` Phase 5).
  - Resolve the `.app` from the just-built `out/` tree (or the mounted DMG the floor-check step already attaches); defensively `xattr -dr com.apple.quarantine` if copied from the DMG.
  - No `--no-sandbox` (the runner user session is a real GUI session, unlike Linux containers).
  - Wipe `~/.pi/dashboard/server.log` before launch so the size assertion reflects this run only.
- **Wire into CI**: add a `Launch-smoke the .app` step to the macOS legs of `_electron-build.yml`, after "Verify deployment target floor", invoking the new script. Each leg's runner arch matches its binary arch (`macos-14`→arm64, `macos-15-intel`→x64), so each runner execs its own native binary.
- **Skip-clean contract**: exit 0 with a clear "skipped — .app missing, run `npm run make` first" when the artifact is absent (PR runs without `make`), mirroring the Linux script.

## Capabilities

### Modified Capabilities

- `electron-qa-coverage`: adds a Requirement that a macOS Electron launch smoke exercises the real main process in-CI on both Mac arches, with the same healthy-launch contract as the Linux smoke.

## Impact

- **Scope**: 1 new script (~80 LOC, near-clone of `08-electron-real-launch.sh`) + ~10 LOC CI step on the two macOS legs.
- **Cost**: ~90 s per macOS leg on existing runners — no new infra, no VM.
- **Coverage gained**: first dynamic proof that `selectLaunchSource` + `spawnFromSource` + `spawnDetached` work end-to-end on macOS; regression net for the Electron-major bump.
- **Honest limitation (in scope to document, out of scope to fix here)**: the runner OS is macOS 14/15 — **above** the advertised floor (10.15 today, 12 post-bump). So this smoke proves "the new Electron **boots**", NOT "boots on the **oldest** allowed macOS". True floor-proof still needs a macOS-12 (or -10.15) VM, which `qa/` does not yet host. Three-layer model:
  - STATIC (`otool minos`) — "binary labeled for floor=N" — exists.
  - DYNAMIC (this smoke) — "binary actually boots" — this change.
  - FLOOR-PROOF (oldest-macOS VM) — "boots on the oldest allowed" — still a gap.
- **Out of scope**:
  - The Electron 32 → 40 / Node 24 bump itself (separate change).
  - A macOS-12 floor-proof VM in `qa/`.
  - Code-signing / notarization changes (the smoke runs the ad-hoc/dev-signed build the make step already produces).
  - Hardening the Windows CI launch smoke (separate concern).
- **Sequencing**: independent and landable now. Lands *before* any `bump-electron-node24` change so the bump has a launch net on day one.
