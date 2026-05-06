## Why

The dashboard server is launched from four call sites with **four different TS-loader resolution chains and four different argv constructions** for the same `node --import <loader> <cli.ts>` pattern:

1. `packages/extension/src/server-launcher.ts` — jiti only (anchored to pi's process)
2. `packages/server/src/cli.ts` (`cmdStart`) — jiti → tsx fallback
3. `packages/electron/src/lib/launch-source.ts` (`spawnFromSource`) — `resolveJitiFromAnchor(cliPath)`
4. `packages/electron/src/lib/server-lifecycle.ts` (legacy `launchServer`) — tsx → jiti fallback

Plus three independent jiti resolvers:
- `packages/shared/src/resolve-jiti.ts` — `resolveJitiImport()` (anchored to `process.argv[1]` / explicit anchor)
- `packages/electron/src/lib/server-lifecycle.ts` — `resolveJitiFromPi()` (managed pi → system pi)
- `packages/electron/src/lib/ts-loader-resolver.ts` — managed pi → global pi

Each implements roughly the same logic (find pi's `node_modules/@mariozechner/jiti/lib/jiti-register.mjs`) with subtly different fallback orders, error messages, and Windows handling. Bugs surface one call site at a time (e.g. `simplify-electron-bootstrap-derived-state` task 13.6: packaged Electron's empty `process.argv[1]` broke `resolveJitiImport()`; fixed by switching to `resolveJitiFromAnchor(cliPath)` in just one of the four sites).

This change consolidates loader resolution and server-spawn argv into a single shared module so every call site goes through the same code path. Originally Phase 3 of the now-archived `electron-wizard-smart-detection`; carved out here because the superseder `simplify-electron-bootstrap-derived-state` did not absorb it.

## What Changes

- Add `resolveJiti()` to `ToolResolver` (`packages/shared/src/platform/binary-lookup.ts`). Resolution order: managed pi (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent`) → system pi via `which()` → caller-supplied anchor (cliPath) → `process.argv[1]`. Returns absolute path to `jiti-register.mjs` or null. Subsumes `resolve-jiti.ts`, `resolveJitiFromPi`, `resolveJitiFromAnchor`, and `ts-loader-resolver.ts`.
- Add `resolveTsLoader()` to `ToolResolver` returning `{ loader: "jiti" | "tsx", importPath: string } | null`. Order: jiti → tsx (only if `replace-tsx-with-jiti` has not yet landed; otherwise tsx branch is a no-op).
- Add shared `packages/shared/src/server-launcher.ts` exporting `launchDashboardServer(opts)`. Owns the `node --import <loader> <cli> ...args` argv via the existing `buildNodeImportArgv` helper, stdio routing (ignore vs log file), detached spawn, health-poll wait, and env construction via `ToolResolver.buildSpawnEnv()`.
- Migrate all four call sites to `launchDashboardServer()`:
  - extension: `loader=jiti-only, stdio=ignore, timeout=2s`
  - cli `cmdStart`: `loader=auto, stdio=logfile, timeout=5s`
  - Electron `spawnFromSource`: `loader=auto, stdio=logfile, timeout=15s, env=buildSpawnEnv`
  - Electron legacy `launchServer`: deleted (replaced by `spawnFromSource` on the new path) or migrated if still reachable.
- Delete `packages/shared/src/resolve-jiti.ts`, `packages/electron/src/lib/ts-loader-resolver.ts`, `resolveJitiFromPi`, `resolveJitiFromAnchor`. Single source of truth on `ToolResolver`.
- Update repo-lints: existing `no-raw-node-import.test.ts` already forbids raw `--import` outside one allow-listed module; allow-list moves from `node-spawn.ts` to the new shared `server-launcher.ts`.

## Capabilities

### New Capabilities
- `server-launch`: Single shared spawn primitive for the dashboard server. `launchDashboardServer(opts)` owns loader resolution, argv, env, stdio, and health-wait for every caller (extension, CLI, Electron).

### Modified Capabilities
- `jiti-loader`: Resolution moves from `resolve-jiti.ts` + scattered helpers into `ToolResolver.resolveJiti()`.

## Impact

- **Files (new)**:
  - `packages/shared/src/server-launcher.ts` — `launchDashboardServer(opts)`.
- **Files (modified)**:
  - `packages/shared/src/platform/binary-lookup.ts` — add `resolveJiti()`, `resolveTsLoader()`.
  - `packages/extension/src/server-launcher.ts` — delegate to shared launcher.
  - `packages/server/src/cli.ts` — `cmdStart` delegates to shared launcher.
  - `packages/electron/src/lib/launch-source.ts` — `spawnFromSource` delegates to shared launcher.
  - `packages/shared/src/__tests__/no-raw-node-import.test.ts` — allow-list update.
- **Files (deleted)**:
  - `packages/shared/src/resolve-jiti.ts`
  - `packages/electron/src/lib/ts-loader-resolver.ts`
  - `resolveJitiFromPi`, `resolveJitiFromAnchor` exports (function-level removals).
- **Coordination**:
  - Overlaps with `replace-tsx-with-jiti`. If that lands first, `resolveTsLoader()` reduces to `resolveJiti()` and the tsx branch is removed. If this change lands first, the tsx fallback stays until `replace-tsx-with-jiti` deletes it.
- **Risk**: Medium. Server spawn is on the hot path for every starter (Bridge, Standalone, Electron). Mitigated by: (a) pure unit tests over the resolver and argv construction, (b) integration tests over each starter path, (c) leaving the old call sites as thin wrappers during the transition until each is verified.
- **No protocol or user-facing changes.**
