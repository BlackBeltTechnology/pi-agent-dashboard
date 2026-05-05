## 1. Pure helper: `extractedSourceIsHealthy`

- [ ] 1.1 Add `extractedSourceIsHealthy(cliPath: string, deps?: { existsSync; resolveJitiFromAnchor }): boolean` to `packages/electron/src/lib/launch-source.ts` (or a new sibling file `extracted-health.ts` if launch-source.ts grows past ~600 lines).
- [ ] 1.2 Default deps wire to real `fs.existsSync` and `resolveJitiFromAnchor` from `@blackbelt-technology/pi-dashboard-shared/resolve-jiti`.
- [ ] 1.3 Helper returns `false` when `cliPath` does not exist OR `resolveJitiFromAnchor(cliPath)` returns `null`.
- [ ] 1.4 Add unit tests covering:
  - cliPath missing → false
  - cliPath present + jiti reachable → true
  - cliPath present + jiti missing → false
  - injected `existsSync` / `resolveJitiFromAnchor` throw → returns false (defensive)

## 2. Wire health check into `extractLaunchSource`

- [ ] 2.1 In `packages/electron/src/lib/launch-source.ts#extractLaunchSource`, after computing `cliPath` and BEFORE the `needsExtraction` branch, compute `healthy = extractedSourceIsHealthy(cliPath)`.
- [ ] 2.2 Change the gate from `if (didExtract)` to `if (didExtract || !healthy)` so the extract + `installStandalone` block also runs when the marker matches but the tree is degraded.
- [ ] 2.3 Log a one-line warn when entering the block due to `!healthy`: `[launch-source] extracted source unhealthy (jiti missing); forcing re-extract`.
- [ ] 2.4 Keep the existing `didExtract` value in the returned `LaunchSource` truthful — it reflects whether `extractBundle` actually copied files this call. (Health-only re-runs may set `didExtract = true` because we'll have re-extracted.)

## 3. Smoke test for the recovery path

- [ ] 3.1 Add a Tier B case to `packages/electron/src/lib/__tests__/launch-source.smoke.test.ts`:
  - Pre-populate a managed dir with a valid `.version` marker matching `bundledMinVersion`.
  - Pre-populate `cliPath` and a valid `@mariozechner/jiti/package.json` next to it (healthy state).
  - Call `selectLaunchSource` once → expect `kind: "extracted"`, `didExtract: false`.
  - Wipe `~/.pi-dashboard/node_modules/@mariozechner` (simulate AV / partial corruption).
  - Call `selectLaunchSource` again → expect `kind: "extracted"`, `didExtract: true` (or any signal that re-extract ran), and `cliPath` exists + jiti resolvable afterward.

## 4. `spawnDetached` stdout capture

- [ ] 4.1 In `packages/shared/src/platform/detached-spawn.ts`, change line `const stdio = [stdioIn, "ignore", opts.logFd ?? "ignore"]` to `const stdio = [stdioIn, opts.logFd ?? "ignore", opts.logFd ?? "ignore"]`.
- [ ] 4.2 Update the JSDoc on `SpawnDetachedOptions.logFd` from "Optional file descriptor for stderr" to "Optional file descriptor for combined stdout + stderr. Caller is responsible for `fs.openSync(logPath, 'a')` and closing the parent's copy after spawn (the child retains its dup via stdio inheritance)."
- [ ] 4.3 Add smoke test `packages/shared/src/platform/__tests__/detached-spawn.smoke.test.ts` (or extend an existing detached-spawn test file):
  - Spawn `node -e 'console.log("hi"); process.stderr.write("bye");'` with a temp logFd.
  - After child exits, read the temp file → assert it contains both `hi\n` and `bye`.
  - Skip on `process.platform !== process.platform` guards if any existing detached-spawn test infra requires it; otherwise enable on all platforms.
- [ ] 4.4 Verify no caller relied on stdout being dropped (search `grep -rn 'spawnDetached' packages/`). All current callers (`extension/server-launcher.ts`, `electron/launch-source.ts#spawnFromSource`, `server/process-manager.ts#spawnHeadlessDetached`) want stdout in the log too. No call sites need updating.

## 5. Documentation

- [ ] 5.1 Update `docs/electron-bootstrap-flow.md` Slice 1 mermaid diagram: insert a `HealthCheck` decision node between `NeedsExtract -- no -->` and `Spawn`, branching to `MigrateExtract` on health-fail.
- [ ] 5.2 Add an Invariants table row: "Extracted source verifies jiti reachability before spawn (`extractedSourceIsHealthy`) — re-extract on miss".
- [ ] 5.3 Add row in `docs/file-index-electron.md` for `extractedSourceIsHealthy` (caveman style).
- [ ] 5.4 Add row in `docs/file-index-shared.md` updating `spawnDetached`'s purpose to mention combined stdout+stderr capture.
- [ ] 5.5 Add a `docs/faq.md` entry: "Why does my server.log stay 0 bytes after a clean Electron launch?" → resolved by this change; pre-fix workaround was `Get-Content $env:TEMP\pi-dashboard-electron.log`.

## 6. Verification

- [ ] 6.1 `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|✗|✘' /tmp/pi-test.log` returns no failures.
- [ ] 6.2 `npm run build` succeeds (workspace-wide tsc).
- [ ] 6.3 Manual: build Windows electron artifact, wipe `~/.pi-dashboard/node_modules/@mariozechner`, launch app → first attempt must succeed without FATAL.
- [ ] 6.4 Manual: launch Electron app → after dashboard window opens, verify `~/.pi/dashboard/server.log` contains the server's startup banner (`Dashboard running on http://localhost:8000`).

## 7. Out of scope (file as separate proposals)

- Duplicate-Electron-pid-per-launch pattern observed in the user log (two pids per launch, only the second runs the launch-source-v2 path). Worth investigating against `app.requestSingleInstanceLock()` semantics in `packages/electron/src/main.ts`.
- Doctor's synthetic launch-test snippet Windows path-escape bug (already fixed in commit `29cb3ea` on branch `simplify-electron-bootstrap-derived-state`; mentioned here for completeness).
