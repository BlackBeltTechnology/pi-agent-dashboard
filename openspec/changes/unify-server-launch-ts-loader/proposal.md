## Why

The dashboard server is launched from four call sites that each construct `node --import <jiti-register.mjs> <cli.ts>` argv by hand, even though a canonical wrapper (`spawnNodeScript` in `packages/shared/src/platform/node-spawn.ts`) already exists. Each site carries a per-line `ban:raw-node-import-ok` opt-out for the repo's `no-raw-node-import` lint, so the lint is full of holes:

1. `packages/extension/src/server-launcher.ts` — `resolveJitiImport()` + raw `["--import", loader, entry, …]`.
2. `packages/server/src/cli.ts` (`cmdStart`) — `resolveJitiImport()` + raw argv.
3. `packages/electron/src/lib/launch-source.ts` (`spawnFromSource`) — `resolveJitiFromAnchor(cliPath) ?? resolveJitiImport()` + raw argv.
4. `packages/electron/src/lib/server-lifecycle.ts` (`launchServer`, legacy V1) — tsx → `resolveJitiFromPi()` fallback + raw argv.

Jiti resolution is centralised in `packages/shared/src/resolve-jiti.ts` (`resolveJitiImport()` argv-anchored + `resolveJitiFromAnchor(anchor)` caller-anchored), but Electron has **two duplicate `resolveJitiFromPi()` wrappers** layered on top — one in `server-lifecycle.ts`, one in `ts-loader-resolver.ts` — both adding the same managed-pi → system-pi probe around the shared anchor resolver.

Net effect: every spawn site re-derives node binary, env, loader, argv, and stdio independently. Bugs surface site-by-site (most recent: `simplify-electron-bootstrap-derived-state` task 13.6 — packaged Electron's empty `process.argv[1]` broke `resolveJitiImport()`; fixed by switching to `resolveJitiFromAnchor(cliPath)` only at one of the four sites).

This change collapses the four call sites onto a single shared launcher and the two electron wrappers onto a single `ToolResolver` method. Originally Phase 3 of the now-archived `electron-wizard-smart-detection`; carved out here because the superseder `simplify-electron-bootstrap-derived-state` did not absorb it.

## What Changes

- Add `ToolResolver.resolveJiti({ anchor? })` to `packages/shared/src/platform/binary-lookup.ts`. Resolution order: managed pi (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent`) → system pi via `which("pi")` → `opts.anchor` (caller-supplied path inside a `node_modules` tree) → `process.argv[1]`. Returns the jiti register hook as a `file://` URL string (matches the contract documented in `resolve-jiti.ts`) or null. Subsumes `resolveJitiImport`, `resolveJitiFromAnchor`, and the two `resolveJitiFromPi` wrappers.
- Add shared `packages/shared/src/server-launcher.ts` exporting `launchDashboardServer(opts)`. Owns: loader resolution (delegating to `ToolResolver.resolveJiti`), argv construction (delegating to the existing `spawnNodeScript`), env construction (delegating to `ToolResolver.buildSpawnEnv()`), stdio routing (`"ignore"` vs `{ logFile }`), detached spawn, and `/api/health` health-poll wait.
- Migrate all four call sites to `launchDashboardServer()`:
  - `extension/server-launcher.ts` — `stdio: "ignore"`, `healthTimeoutMs: 2000`.
  - `server/cli.ts cmdStart` — `stdio: { logFile }`, `healthTimeoutMs: 5000`.
  - `electron/launch-source.ts spawnFromSource` — `anchor: source.cliPath`, `stdio: { logFile }`, `healthTimeoutMs: 15000`, `env: ToolResolver.buildSpawnEnv()`.
  - `electron/server-lifecycle.ts launchServer` — if still reachable when `LAUNCH_SOURCE_V2=false`, migrate; otherwise delete with the legacy path. tsx branch goes either way (see Coordination).
- Delete `packages/shared/src/resolve-jiti.ts` (subsumed by `ToolResolver.resolveJiti`). Remove `resolveJitiFromPi` from both `server-lifecycle.ts` and `ts-loader-resolver.ts`; delete `ts-loader-resolver.ts` once nothing imports it.
- Remove the four `ban:raw-node-import-ok` opt-out comments at the migrated spawn sites. Tighten `packages/shared/src/__tests__/no-raw-node-import.test.ts` allow-list to **exactly** `node-spawn.ts` and `server-launcher.ts` (drop `resolve-jiti.ts`, since it ceases to exist).

## Capabilities

### New Capabilities
- `server-launch`: Single shared spawn primitive (`launchDashboardServer`) for the dashboard server. Every starter (Bridge, Standalone, Electron) routes through it.

### Modified Capabilities
- `jiti-loader`: Resolution moves from `resolve-jiti.ts` + scattered electron wrappers into `ToolResolver.resolveJiti()`. Public callers shrink from four named exports to one method.

## Impact

- **Files (new)**:
  - `packages/shared/src/server-launcher.ts` — `launchDashboardServer(opts)`.
- **Files (modified)**:
  - `packages/shared/src/platform/binary-lookup.ts` — add `resolveJiti({ anchor? })`.
  - `packages/extension/src/server-launcher.ts` — delegate to shared launcher; drop opt-out comment.
  - `packages/server/src/cli.ts` — `cmdStart` delegates to shared launcher; drop opt-out comment.
  - `packages/electron/src/lib/launch-source.ts` — `spawnFromSource` delegates; remove inline `resolveJitiFromAnchor ?? resolveJitiImport` chain and opt-out comment.
  - `packages/electron/src/lib/server-lifecycle.ts` — drop `resolveJitiFromPi`; legacy `launchServer` either migrated or removed with the legacy V1 path.
  - `packages/shared/src/__tests__/no-raw-node-import.test.ts` — tighten allow-list.
- **Files (deleted)**:
  - `packages/shared/src/resolve-jiti.ts` and its tests (cases ported to `resolveJiti` tests).
  - `packages/electron/src/lib/ts-loader-resolver.ts`.
- **Coordination**:
  - Overlaps with the still-open `replace-tsx-with-jiti` change. Current state (verified): `extension/server-launcher.ts` and `server/cli.ts cmdStart` are already jiti-only; the only remaining tsx fallback is the legacy V1 path in `electron/server-lifecycle.ts`. With `LAUNCH_SOURCE_V2` defaulted to true in `simplify-electron-bootstrap-derived-state` task 6.5, that path is effectively cold. This change therefore drops tsx support entirely from the new launcher rather than carrying a `resolveTsLoader` complication. If `replace-tsx-with-jiti` lands first, no change needed; if this lands first, `replace-tsx-with-jiti` only deletes the tsx dependency and the cli.ts shebang.
- **Risk**: Medium. Server spawn is on the hot path for every starter. Mitigated by: (a) leaving the legacy `electron/server-lifecycle.ts launchServer` migration last; (b) unit tests over `resolveJiti` cases ported from `resolve-jiti.test.ts`; (c) integration tests for each starter (Bridge auto-spawn, `pi-dashboard start`, Electron cold-launch via every `LaunchSource`).
- **No protocol or user-facing changes.**
