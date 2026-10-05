# Fix AppImage cold-boot latency — Node-native TypeScript loader by default

## Why

`CI Electron (on-demand)` step **"Smoke the AppImage on Ubuntu 22.04 (glibc floor)"**
(`.github/workflows/_electron-build.yml`) fails: the app does not reach
`http://localhost:8000/api/health` within the 90 s budget. The same step reached health in
~18 s on 2026-08-26. The parent of PR #806 hangs too, so the regression is pre-existing on
`develop` (run 37257523608).

The spike on branch `spike/native-ts-loader` (`bd14b0696`, `f58e56b4d`) attributed the time.
Both loaders ran against the same extracted AppImage in the same 22.04 container:

| run | loader | `/api/health` |
|---|---|---|
| 37285545559 | Node-native (`stripTypeScriptTypes`) | 3 s, 18 plugins loaded |
| 37285545559 | jiti | timeout at 240 s; `server running` came ~4 min after launch |
| 37286703495 | Node-native | 5 s |
| 37286703495 | jiti (run first) | timeout at 240 s; only the launch line was logged |

So the cost sits in jiti's transpile/load path. A container-only blocking step is ruled out
(H3), because the native loader boots the same server and plugin graph in seconds. On a
FUSE-mounted AppImage, jiti's default cache dir is read-only squashfs. That makes every real-user
launch a cold jiti transpile as well.

## What Changes

- **The Node-native TypeScript loader becomes the default for every dashboard-server launch.**
  This covers the CLI `pi-dashboard`, Electron, the bridge auto-start, the launch helpers,
  restart, and worker threads. The loader is a `--import` register module that installs
  resolve/load hooks: `.js`→`.ts` and extensionless/directory resolution, type stripping via
  `node:module` `stripTypeScriptTypes` in `transform` mode (also under `node_modules`), and JSON
  import attributes.
- **jiti stays as an opt-in fallback.** Setting `PI_DASHBOARD_TS_LOADER=jiti` restores today's
  jiti launch, with resolution unchanged. The native path no longer requires jiti, so a missing
  jiti fails only when jiti is selected.
- **Server-loaded first-party code becomes loader-neutral.** It must not rely on the CJS globals
  that jiti injected (`require`, `__dirname`, `__filename`, `module`, `exports`). Known
  offender: `packages/server/src/routes/file-routes.ts:212` (`require("asciidoctor")`). A
  static gate keeps it that way.
- **The 22.04 smoke reports per-phase boot timings** for the shipped loader, on success and on
  failure. The 90 s budget stays.
- **jiti regression attribution is documentation-only.** We record why jiti went from 18 s to
  more than 240 s, but this does not block the fix.

Out of scope:
- Plugin third-party dependency installation (`bundle-plugin-third-party-deps`), including
  `gmail` failing on `oauth4webapi` under both loaders.
- pi's own extension loading. pi loads the bridge and plugin bridge entries with its own jiti,
  which this change does not touch.
- Pre-compiling the server to JS.

## Capabilities

- New `native-ts-loader`. Covers the register module's resolve/load contract and the
  loader-neutral server-source gate.
- `server-launch`:
  - ADDED: loader selection, with native as the default and jiti opt-in.
  - MODIFIED: jiti resolution applies only when jiti is selected, and the spawn log header names
    the loader.
- `dashboard-server` MODIFIED:
  - the CLI bin entry selects its loader
  - the canonical argv helpers gain `isNativeTsLoader`
  - Doctor's launch test checks the selected loader
- `packaging` MODIFIED: the bin wrapper is no longer jiti-only.
- `jiti-loader` MODIFIED: jiti resolution is the fallback path.
- `electron-launch-source` MODIFIED: the uniform spawn argv carries the selected loader, and the
  wrapper fails loud only for the selected loader.
- `electron-shell` MODIFIED: launch uses the selected loader.
- `bridge-extension` MODIFIED: the bridge resolves jiti only when jiti is selected.
- `jiti-cjs-transpile-safety` MODIFIED: the seed-2 rationale reflects the jiti fallback; the file
  set is unchanged.
- `electron-build-pipeline` ADDED: the AppImage boots within budget on the glibc floor and
  reports per-phase timings.

## Impact

- `packages/shared/src/platform/` adds the `native-ts-register.mjs` and `native-ts-hooks.mjs`
  register modules and the `.mjs` loader-selection helper.
- Launch sites that change:
  - `packages/shared/src/server-launcher.ts`, which selects the loader
  - `packages/shared/src/platform/node-spawn.ts`, which handles the loader-type predicates
  - `packages/server/bin/pi-dashboard.mjs`, the pre-loader wrapper
  - `packages/electron/scripts/server-launch-helpers/start-server.{sh,cmd,ps1}`
  - `packages/server/src/attachments/fit-worker-pool.ts`, which supplies its own loader
  - `packages/server/src/spawn-process/restart-helper.ts`, which reuses the current loader
  - `packages/extension/src/server-launcher.ts` and `server-auto-start.ts` (bridge auto-start),
    where `JitiNotFoundError` handling becomes jiti-only
  - `packages/shared/src/doctor-core.ts`, whose TS-loader check must treat native as satisfying
  - `packages/electron/src/lib/doctor.ts`, whose launch-test probe must use the selected loader
  - `packages/electron/scripts/assert-bundled-server-plugin-load.mjs`, the build gate, which must
    boot with the selected loader
  - `scripts/lib-jiti-scope.mjs`, whose seeds get tagged by kind for the new gate
- `packages/server/src/routes/file-routes.ts` drops its bare `require`.
- `.github/workflows/_electron-build.yml` gets the timing table.
- Compatibility and rollback:
  - Users roll back by setting `PI_DASHBOARD_TS_LOADER=jiti` and then doing a fresh launch.
    `/api/restart` keeps the running loader. Reverting the code is the full rollback.
  - No data migration.
  - Node floor stays `>=22.19.0`. `stripTypeScriptTypes` exists from 22.13, and `module.register`
    is available on that floor.

## Discipline Skills

- `systematic-debugging` — the spike evidence attributed the cause; the jiti attribution
  documents why it regressed.
- `performance-optimization` — boot latency budget; the timing table measures it in CI.
- `observability-instrumentation` — per-phase boot timings plus the loader in the spawn log header.
- `doubt-driven-review` — the default loader changes on every launch path, which is effectively a
  public runtime contract.

## References

- Spike branch `spike/native-ts-loader` (worktree `../pi-spike-native-ts`). Runs 37285545559 and
  37286703495.
- PR #806 (`fix/electron-plugin-load-gate-log`), under "Known remaining red".
- Archived changes: `2026-05-05-fix-electron-extracted-jiti-and-stdio-capture`,
  `2026-05-10-replace-tsx-with-jiti`, `2026-06-29-fix-stale-bundled-server-cache`.
