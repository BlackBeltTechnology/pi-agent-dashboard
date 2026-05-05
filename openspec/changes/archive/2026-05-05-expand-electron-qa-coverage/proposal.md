## Why

Two production bugs (`fix-electron-extracted-jiti-and-stdio-capture`) shipped in v0.4.6 despite the Linux Docker QA suite passing. Root cause: every existing Linux test exercises **only the happy path of a fresh install** and **bypasses the Electron-specific bootstrap glue**:

| Existing test | What it actually exercises | What it skips |
|---|---|---|
| `qa/tests/02-server-start.sh` | `pi-dashboard start` via npm-installed CLI | Electron, `selectLaunchSource`, the `extracted` source kind |
| `qa/tests/06-electron-offline-bundle.sh` | Static layout check on `Resources/` | All runtime behavior — never spawns anything |
| `packages/electron/scripts/test-electron-install-inner.sh` | Mirrors `selectLaunchSource` 8-stage flow as a bash script; spawns `node --import jiti cli.ts` directly | (a) Always starts from empty `~/.pi-dashboard/`, never simulates a degraded second-boot. (b) Spawns server with `bash > log 2>&1`, bypassing `spawnDetached` entirely. (c) Doesn't run real Electron main process — no `process.execPath` quirks, no Windows job-object path, no `app.requestSingleInstanceLock()`. |
| `qa/tests/07-electron-bootstrap-v2.ps1` | Real Electron app on Windows VM | Doesn't assert `~/.pi/dashboard/server.log` non-empty after launch; doesn't simulate degraded managed dir. |

Concrete consequence: the user's Windows install logged

```
[launch-source-v2] resolved kind=extracted
FATAL: Cannot find pi's TypeScript loader (jiti).
```

on every launch — which would have failed `07-electron-bootstrap-v2.ps1` if the test asserted "first launch must reach `/api/health`". And `~/.pi/dashboard/server.log` was 0 bytes — which would have failed any assertion of "log file non-empty after a clean spawn". Neither assertion exists.

This change adds three minimal, complementary checks that cost little to run and would have caught both bugs in CI before tagging v0.4.6.

## What Changes

- **Add Stage 9 "degraded re-extract" to `test-electron-install-inner.sh`.** After the existing happy-path Stages 1-8 succeed, wipe `~/.pi-dashboard/node_modules/@mariozechner` (simulates AV / partial uninstall / npm prune), re-run a subset of the script's logic that mirrors `selectLaunchSource` (read marker, decide health, force re-install if unhealthy), and assert `cliPath` + `jiti` are reachable again. This is the bash-script counterpart of the new Tier-B vitest smoke from change `fix-electron-extracted-jiti-and-stdio-capture`.
- **Assert `~/.pi/dashboard/server.log` is non-empty in `07-electron-bootstrap-v2.ps1`.** After waiting for `/api/health` to respond, read the log file with `Get-Content`. Fail the test if the file does not exist OR is 0 bytes. Apply the same assertion to `qa/tests/02-server-start.sh` (its server log path is different but the principle is identical: a successful spawn must produce captured output).
- **Add a Linux Electron headless smoke** (`qa/tests/08-electron-real-launch.sh`). Uses xvfb-run + the AppImage build to actually launch the Electron main process inside the existing Ubuntu QA VM. Asserts: (a) `pi-dashboard.exe`-equivalent process is running 30 s after launch, (b) `/api/health` responds with `starter: "Electron"`, (c) `~/.pi/dashboard/server.log` non-empty, (d) Electron parent stdout/stderr (captured via `tee`) does not contain the substring `FATAL`. Skips with a clear reason when the AppImage artifact is absent (e.g. fresh-clone CI run before `npm run make`).
- **Wire the new tests into `qa/tests/run-all.sh`** and the GitHub Actions matrix where applicable. Update `qa/Makefile`'s `test-linux-x86` target to include the new headless smoke. Document the new tests in `qa/README.md`.

No production code changes. All three additions are test-only and gated by skip-on-missing-prerequisite checks so they don't block the QA suite on machines without the Electron build artifact present.

## Capabilities

### New Capabilities
- `electron-qa-coverage`: explicit assertions that (a) the bootstrap auto-recovers from a degraded managed dir, (b) `spawnDetached`'s `logFd` actually captures both streams as observed in a packaged app, and (c) the real Electron main process reaches a healthy server on a clean Linux VM.

## Impact

Affected files:
- `packages/electron/scripts/test-electron-install-inner.sh` — append Stage 9 (degraded re-extract).
- `qa/tests/02-server-start.sh` — assert `~/.pi/dashboard/server.log` non-empty after `/api/health` succeeds.
- `qa/tests/07-electron-bootstrap-v2.ps1` — assert `~/.pi/dashboard/server.log` non-empty after dashboard window opens; existing health assertion already in place.
- `qa/tests/08-electron-real-launch.sh` (new) — xvfb-driven AppImage smoke.
- `qa/tests/run-all.sh` — invoke 08.
- `qa/Makefile` — `test-linux-x86` target picks up 08; add `--with-electron` opt-in if 08's AppImage cost is too high to run on every PR.
- `qa/README.md` — document the new tests + their skip conditions.
- `qa/packer/scripts/linux/install-deps.sh` (or equivalent) — add `xvfb` to the Ubuntu base image package list.
- `.github/workflows/publish.yml` (if it currently runs Docker QA) — opt-in flag for the headless Electron smoke matrix entry.

Cost / runtime impact:
- Stage 9 added to the existing installer test: ~10 s extra (re-uses already-extracted bundle).
- Log-non-empty assertion in 02 / 07: <100 ms.
- New headless smoke 08: ~60 s on Linux VM. Skippable when AppImage absent. Not run on Windows / macOS QA flows.

Migration / compatibility / rollback:
- No production code or schema changes.
- Rollback: revert this change; QA falls back to the prior (incomplete) suite.
- No risk of false-positive flakes if the assertion logic is conservative — degraded-state simulation deletes a known subdirectory, then re-runs the resolver.

Out of scope (file separately if needed):
- Single-instance-lock duplicate-PID race observed in user's Electron log (two PIDs per launch, only the second resolves `kind: extracted`). Worth its own QA test plus a fix in `main.ts`.
- macOS QA equivalents (current QA infrastructure has no macOS automation; would require self-hosted runner).
