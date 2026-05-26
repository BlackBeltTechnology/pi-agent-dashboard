## Context

The shared primitive `launchDashboardServer(opts)` in `packages/shared/src/server-launcher.ts` accepts an optional `nodeBin` and falls back to `process.execPath`:

```ts
const nodeBin = opts.nodeBin ?? process.execPath;
```

This is correct for the Bridge auto-spawn path (bridge runs under real Node, so `process.execPath` is a Node binary) and for the standalone CLI (`pi-dashboard start` is invoked by a real Node).

In the Electron app, `process.execPath` is the GUI binary (`/Applications/PI-Dashboard.app/Contents/MacOS/pi-dashboard` on macOS, `pi-dashboard.exe` on Windows, the AppImage entry on Linux). Running it without `ELECTRON_RUN_AS_NODE=1` launches a second Electron instance, which hits the single-instance lock from `main.ts` and exits without writing any output. The only line that lands in `~/.pi/dashboard/server.log` is the launcher's own header, leading to the silent-failure symptom verified on `v0.5.3`:

```
[2026-05-12T22:20:57.076Z] Electron launch (parent pid 1457, port 8000, cli /Users/robson/.pi-dashboard/...)
[2026-05-12T22:21:08.047Z] Electron launch (parent pid 1575, port 8000, cli /Users/robson/.pi-dashboard/...)
```

Both Electron call sites — V2 `spawnFromSource` in `launch-source.ts` and legacy V1 `launchServer` in `server-lifecycle.ts` — currently omit `nodeBin`. The `bundled-node-runtime` capability already ships `Resources/node/bin/node` (v22.18.0 on the running install), so the binary is available; nobody is using it.

Stakeholders: every Electron-app user after a clean boot when no prior dashboard process exists. Workaround today is starting a `pi` CLI session so the bridge spawns the server.

## Goals / Non-Goals

**Goals:**
- Electron-spawned server processes use a real Node binary, deterministically.
- Bundled Node is preferred (zero external dependencies, matches the `bundled-node-runtime` contract).
- A defence-in-depth path exists for the case where bundled Node is missing or unreadable.
- Failure mode is loud (typed error visible in the loading-page log tail), never silent.
- Repo-lint pins the fix so future refactors can't regress.

**Non-Goals:**
- Changing the Bridge / CLI / restart-helper paths. They already pass a real Node binary.
- Adding system-Node detection beyond what `detectSystemNode()` already does.
- Modifying `launchDashboardServer` itself. The fallback `process.execPath` stays — correct for non-Electron hosts.
- Adding new build/packaging steps. `bundled-node-runtime` already ships the binary.
- Changing the `LaunchSource` resolver. Source selection is orthogonal to Node-binary selection.

## Decisions

### D1. New pure helper `pickNodeForServer`

Add `packages/electron/src/lib/pick-node.ts` exporting:

```ts
export interface PickNodeInput {
  bundledNodeDir: string | null;   // <app>/Contents/Resources/node on mac/linux, <app>\resources\node on win
  systemNode: { found: boolean; path?: string; version?: string };
  processExecPath: string;          // injected for testability
  platform: NodeJS.Platform;        // injected for testability
}

export type PickNodeResult =
  | { kind: "bundled"; nodeBin: string }
  | { kind: "system"; nodeBin: string; version: string }
  | { kind: "execpath-fallback"; nodeBin: string; needsElectronRunAsNode: true };

export function pickNodeForServer(input: PickNodeInput): PickNodeResult;
```

Rules:
1. If `bundledNodeDir` resolves to an existing executable (`bin/node` on POSIX, `node.exe` on Windows) → return `bundled`.
2. Else if `systemNode.found` AND version passes `isKnownBadNode(version) === false` → return `system`.
3. Else return `execpath-fallback` with the flag that forces `ELECTRON_RUN_AS_NODE=1`.

Rationale: pure function = trivially unit-testable across all three branches. Returning a discriminated union lets the caller decide whether to also stamp `ELECTRON_RUN_AS_NODE=1`.

**Alternatives considered:**
- *Always use bundled, fail if missing.* Rejected — too brittle for dev environments where `bundledNodeDir` is null.
- *Stamp `ELECTRON_RUN_AS_NODE=1` unconditionally.* Rejected — works on macOS/Linux but masks the underlying mis-selection; we'd lose error visibility when bundled-node is absent.

### D2. Both Electron launchers call `pickNodeForServer` before `launchDashboardServer`

V2 `spawnFromSource` and V1 `launchServer` each:
1. Call `pickNodeForServer({ bundledNodeDir: getBundledNodeDir(), systemNode: detectSystemNode(), processExecPath: process.execPath, platform: process.platform })`.
2. Pass `nodeBin: pick.nodeBin` into `launchDashboardServer`.
3. If `pick.kind === "execpath-fallback"` → set `env.ELECTRON_RUN_AS_NODE = "1"` AND log a warning via `electron.log`.

Rationale: single decision point per launcher; trivially auditable.

### D3. Defence-in-depth: `ELECTRON_RUN_AS_NODE=1` for execPath fallback only

Only stamped when `pick.kind === "execpath-fallback"`. Not stamped for bundled/system Node — those don't need it, and stamping it unconditionally would force the bundled Node to also enter Electron's run-as-node mode (works, but adds an unnecessary code path with no test coverage).

### D4. Repo-lint: `no-electron-execpath-spawn`

New test at `packages/shared/src/__tests__/no-electron-execpath-spawn.test.ts` scans `packages/electron/src/lib/**/*.ts` and asserts:
- Every call expression matching `launchDashboardServer(` has either a `nodeBin:` property or `ELECTRON_RUN_AS_NODE` in the visible env map within the same call literal.
- Allowlist: only `pick-node.ts` may reference `process.execPath` in Electron lib code without surrounding `nodeBin:` setup.

Matches the existing `no-raw-node-import` / `no-direct-process-kill` lint pattern.

### D5. Loud failure on unsupported execPath fallback on Windows

On Windows, `process.execPath` is `pi-dashboard.exe` — ELECTRON_RUN_AS_NODE=1 works there too per upstream Electron docs, so D3 stands cross-platform. No additional Windows-specific gating needed.

## Risks / Trade-offs

- **[Risk] Bundled Node missing in dev `npm start`** → Mitigation: dev runs hit `pick.kind === "system"` (nvm-managed Node passes `isKnownBadNode` check). Test fixture covers the null-bundled case explicitly.
- **[Risk] `detectSystemNode()` returns a node that passes `isKnownBadNode` but is on a version older than the bundled minimum** → Mitigation: out of scope here. `electron-launch-source` already version-gates the **server source**; Node-binary version-gate is a separate concern tracked elsewhere.
- **[Risk] `ELECTRON_RUN_AS_NODE=1` propagates into pi child-process spawns started by the server** → Mitigation: `ToolResolver.buildSpawnEnv` already strips Electron-internal vars (`ELECTRON_RUN_AS_NODE`, `ELECTRON_DEFAULT_ERROR_MODE`, etc.) when constructing the spawn env. Confirm in implementation; add a test if not present.
- **[Risk] Regression in legacy V1 path that's only reachable via `LAUNCH_SOURCE_V2=false`** → Mitigation: V1 receives the same fix; both paths call `pickNodeForServer`.
- **[Trade-off] We don't centralise the picker into `launchDashboardServer` itself** → Keeps the shared primitive host-agnostic; Electron is the only host with this quirk.

## Migration Plan

No migration required. Pure runtime fix.

- **Deploy**: ship in the next Electron app release (`v0.5.4`).
- **Rollback**: revert the two launcher edits — fallback returns to current behaviour (silent failure on cold boot).
- **Verification**: cold-boot QA on macOS (existing manual QA), plus the unit + lint additions.

## Open Questions

- *None blocking.* Existing `detectSystemNode()` + `getBundledNodePath()` helpers already cover the inputs we need; the helper above just composes them.
