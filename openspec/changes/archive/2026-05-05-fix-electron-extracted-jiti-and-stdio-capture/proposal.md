## Why

Two bugs surface together in real-world Windows desktop installs and were caught analyzing `%TEMP%\pi-dashboard-electron.log` from a v0.4.6 user:

**Bug 1 — Every launch FATALs once before succeeding.** `selectLaunchSource()` resolves to `kind: "extracted"` and returns a `cliPath` under `~/.pi-dashboard/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts`. `spawnFromSource()` then calls `resolveJitiFromAnchor(cliPath) ?? resolveJitiImport()`. When the managed install is in a degraded state (e.g. `@mariozechner/jiti` missing, partial extraction, AV quarantine, user wiped `node_modules`), `resolveJitiFromAnchor` returns `null`. The fallback `resolveJitiImport()` reads `process.argv[1]`, which inside packaged Electron is the `.exe` path — `createRequire` from there cannot find pi/jiti, and the function throws:

```
FATAL: Cannot find pi's TypeScript loader (jiti).
Is @mariozechner/pi-coding-agent or @oh-my-pi/pi-coding-agent installed?
```

The user retries, the second launch happens to trigger extraction (or `installStandalone` runs), and the dashboard finally starts. From the user log:

```
18:14:03.960 [launch-source-v2] resolved kind=extracted
18:14:03.961 FATAL: Cannot find pi's TypeScript loader (jiti). ...
18:15:23.378 === Electron starting ===   (user re-launched)
18:15:49.148 [launch-source-v2] resolved kind=extracted
18:15:49.174 [launch-source-v2] spawned server pid=4536  ✅
```

The root cause is in `bundle-extract.ts#needsExtraction`: it only checks the `.version` marker, not whether the extracted tree is actually usable. After a successful extraction the marker is written, so subsequent calls with the same version skip extraction even if the tree was later corrupted. Consequence: the dashboard fails to start on first attempt for any user whose managed install is in a degraded state, until they retry enough times for the marker to mismatch or for some other path to repair the tree.

**Bug 2 — `~/.pi/dashboard/server.log` is 0 bytes after a successful spawn.** `spawnDetached(opts)` builds `stdio` as:

```ts
const stdio = [stdioIn, "ignore", opts.logFd ?? "ignore"];
//                       ^^^^^^^^   stdout hard-coded to ignore
```

Only `stderr` reaches `logFd`. A clean server startup emits its banner via `console.log` → `stdout` → discarded → log file stays empty. This blinds every "why didn't the server start?" debugging session, including this one. `packages/server/src/cli.ts` already does this correctly with raw `spawn()` (`stdio: ["ignore", logFd, logFd]`); `spawnDetached` is the outlier.

## What Changes

- **Health-check the `extracted` source before returning it.** In `packages/electron/src/lib/launch-source.ts#extractLaunchSource`, after `needsExtraction` says "no" (marker matches), additionally probe `existsSync(cliPath) && resolveJitiFromAnchor(cliPath) !== null`. If either fails, force the extract + `installStandalone` path even though the version marker already matches. The probe lives in a new pure helper `extractedSourceIsHealthy(cliPath, deps)` so it can be unit-tested with memfs.
- **Route `logFd` to both stdout and stderr in `spawnDetached`.** Change `stdio[1]` from hard-coded `"ignore"` to `opts.logFd ?? "ignore"` so stdout is captured alongside stderr. Update the doc comment from "Optional file descriptor for stderr" to "Optional file descriptor for combined stdout + stderr". Behavior is additive: callers that don't pass `logFd` keep `"ignore"` for both.
- **Add a small smoke test for `spawnDetached` log capture** (`spawn-detached-output.smoke.test.ts`) that spawns `node -e 'console.log("hi"); process.stderr.write("bye")'` with a temp logFd and asserts the file contains both `hi\n` and `bye`.
- **Add a unit test for `extractedSourceIsHealthy`** covering: cliPath missing → unhealthy; cliPath present + jiti reachable → healthy; cliPath present + jiti missing (broken managed dir) → unhealthy.
- **Update `docs/electron-bootstrap-flow.md`** Slice 1 mermaid: insert a `HealthCheck` decision node between `NeedsExtract -> no` and `Spawn`, branching to `MigrateExtract` when health probe fails. Add a row to the "Invariants" table: "extracted source health-checks jiti reachability before spawn".

No breaking API changes. `extractedSourceIsHealthy` is a new export. `spawnDetached` keeps the same signature; the only behavioral change is stdout being captured when `logFd` is set, which previously was silently discarded — i.e. strictly more output, never less.

## Capabilities

### Modified Capabilities
- `electron-shell`: the `extracted` LaunchSource resolution path SHALL verify jiti is reachable from `cliPath` before returning, and SHALL trigger extraction + `installStandalone` when not reachable, regardless of the `.version` marker.

### New Capabilities
- `spawn-detached-output`: `spawnDetached`'s `logFd` option SHALL route both child stdout and stderr to the supplied file descriptor. When `logFd` is omitted, both streams SHALL be `"ignore"` (no behavior change for that case).

## Impact

Affected code:
- `packages/electron/src/lib/launch-source.ts` — add `extractedSourceIsHealthy` helper, call it in `extractLaunchSource` to gate the marker-skip path.
- `packages/electron/src/lib/__tests__/launch-source.test.ts` — add cases covering healthy/unhealthy extracted source.
- `packages/electron/src/lib/__tests__/launch-source.smoke.test.ts` — add Tier B smoke case where managed dir is partially wiped between two `selectLaunchSource` calls; second call SHALL re-extract.
- `packages/shared/src/platform/detached-spawn.ts` — change `stdio[1]` wiring; update doc comment.
- `packages/shared/src/platform/__tests__/detached-spawn.smoke.test.ts` — new file: verify combined stdout+stderr capture.
- `docs/electron-bootstrap-flow.md` — bootstrap diagram + invariants update.
- `docs/file-index-electron.md` — add row for `extractedSourceIsHealthy` once introduced.

Migration / compatibility:
- No on-disk migration. The fix is detect-and-recover.
- Users who repeatedly hit "FATAL: Cannot find pi's TypeScript loader (jiti)" SHALL recover automatically on the next Electron launch (extraction re-runs).
- No protocol/API/database changes.

Rollback:
- Revert this change; the previous behavior (FATAL on degraded managed dir, empty server.log) is restored. No data corruption risk either direction.
