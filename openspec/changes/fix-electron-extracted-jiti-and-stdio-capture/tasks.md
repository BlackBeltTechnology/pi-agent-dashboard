## 1. Pure helper: `extractedSourceIsHealthy`

- [x] 1.1 Add `extractedSourceIsHealthy(cliPath: string, deps?: { existsSync; resolveJitiFromAnchor }): boolean` to `packages/electron/src/lib/launch-source.ts` (or a new sibling file `extracted-health.ts` if launch-source.ts grows past ~600 lines).
- [x] 1.2 Default deps wire to real `fs.existsSync` and `resolveJitiFromAnchor` from `@blackbelt-technology/pi-dashboard-shared/resolve-jiti`.
- [x] 1.3 Helper returns `false` when `cliPath` does not exist OR `resolveJitiFromAnchor(cliPath)` returns `null`.
- [x] 1.4 Add unit tests covering:
  - cliPath missing → false
  - cliPath present + jiti reachable → true
  - cliPath present + jiti missing → false
  - injected `existsSync` / `resolveJitiFromAnchor` throw → returns false (defensive)

## 2. Wire health check into `extractLaunchSource`

- [x] 2.1 In `packages/electron/src/lib/launch-source.ts#extractLaunchSource`, after computing `cliPath` and BEFORE the `needsExtraction` branch, compute `healthy = extractedSourceIsHealthy(cliPath)`.
- [x] 2.2 Change the gate from `if (didExtract)` to `if (didExtract || !healthy)` so the extract + `installStandalone` block also runs when the marker matches but the tree is degraded.
- [x] 2.3 Log a one-line warn when entering the block due to `!healthy`: `[launch-source] extracted source unhealthy (jiti missing); forcing re-extract`.
- [x] 2.4 Keep the existing `didExtract` value in the returned `LaunchSource` truthful — it reflects whether `extractBundle` actually copied files this call. (Health-only re-runs may set `didExtract = true` because we'll have re-extracted.)

## 3. Smoke test for the recovery path

- [x] 3.1 Add a Tier B case to `packages/electron/src/lib/__tests__/launch-source.smoke.test.ts`:
  - Implemented as "recovers when managed dir is degraded (jiti missing) — re-extract on second call".
  - First `selectLaunchSource` runs full extract+install (healthy state).
  - Wipes `~/.pi-dashboard/node_modules/@mariozechner` to simulate AV / partial corruption.
  - Asserts `resolveJitiFromAnchor(cliPath)` returns null in degraded state.
  - Second `selectLaunchSource` re-extracts and `resolveJitiFromAnchor(cliPath)` becomes truthy again.
  - Smoke run: 34s, passes.

## 4. `spawnDetached` stdout capture

- [x] 4.1 Replaced with `const outFd = opts.logFd ?? "ignore"; const stdio = [stdioIn, outFd, outFd]` so the same fd lands in both slots.
- [x] 4.2 Updated the JSDoc on `SpawnDetachedOptions.logFd` to describe combined stdout + stderr capture and reference this change.
- [x] 4.3 Added test in existing `packages/shared/src/__tests__/detached-spawn.test.ts`: "redirects BOTH stdout and stderr to logFd when provided". Spawns `node -e` writing to both streams, asserts log contains both. 17 tests pass.
- [x] 4.4 Audited all 6 production call sites (`extension/server-launcher.ts`, `server/process-manager.ts` x3, `electron/server-lifecycle.ts` x2, `electron/launch-source.ts`). All pass `logFd` for diagnostic capture; none rely on stdout being silently dropped. No call sites updated.

## 5. Documentation

- [x] 5.1 Updated `docs/electron-bootstrap-flow.md` Slice 1 mermaid diagram with `HealthCheck{extractedSourceIsHealthy}` decision node between `NeedsExtract -->|no|` and `Spawn`, branching to `MigrateExtract` on health-fail.
- [x] 5.2 Added Invariants table row pointing to `extractedSourceIsHealthy` in launch-source.ts.
- [x] 5.3 Added row in `docs/file-index-electron.md` for `extractedSourceIsHealthy`.
- [x] 5.4 Updated `docs/file-index-shared.md` row for `detached-spawn.ts` noting `logFd` routes to BOTH stdout + stderr.
- [x] 5.5 Added `docs/faq.md` entry "Why does my server.log stay 0 bytes after a clean Electron launch?" with pre-fix workaround pointing to `$TMPDIR/pi-dashboard-electron.log`.

## 6. Verification

- [x] 6.1 `npm test` run: 4495 passed, 9 skipped, 1 failure UNRELATED to this change (`no-raw-openspec-status-in-skills.test.ts` — pre-existing skill-file lint, confirmed by stashing this change's diff and reproducing the failure on stock branch).
- [x] 6.2 `npm run build` succeeded (workspace-wide tsc + Vite client bundle).
- [ ] 6.3 Manual: build Windows electron artifact, wipe `~/.pi-dashboard/node_modules/@mariozechner`, launch app → first attempt must succeed without FATAL. (Deferred — requires Windows host. Smoke test in 3.1 covers the algorithmic path on macOS.)
- [ ] 6.4 Manual: launch Electron app → after dashboard window opens, verify `~/.pi/dashboard/server.log` contains the server's startup banner. (Deferred — requires running Electron build. Unit test in 4.3 covers the spawnDetached fd contract.)

## 7. Out of scope (file as separate proposals)

- Duplicate-Electron-pid-per-launch pattern observed in the user log (two pids per launch, only the second runs the launch-source-v2 path). Worth investigating against `app.requestSingleInstanceLock()` semantics in `packages/electron/src/main.ts`.
- Doctor's synthetic launch-test snippet Windows path-escape bug (already fixed in commit `29cb3ea` on branch `simplify-electron-bootstrap-derived-state`; mentioned here for completeness).
