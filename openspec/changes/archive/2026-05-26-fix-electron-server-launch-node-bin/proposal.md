## Why

When the Electron app spawns the dashboard server (`spawnFromSource` / legacy `launchServer`), it calls `launchDashboardServer({…})` without an explicit `nodeBin`. The shared launcher falls back to `process.execPath`, which in Electron main is the GUI binary (`/Applications/PI-Dashboard.app/Contents/MacOS/pi-dashboard`), not a Node interpreter. Without `ELECTRON_RUN_AS_NODE=1` in the spawn env, the spawned process re-launches the Electron GUI, hits the single-instance lock, and exits silently — producing no log output beyond the launcher header line.

User-visible symptom: after a fresh boot, the Electron app's loading page shows "Cannot connect to dashboard server" and retrying the Start-server button produces only the `[<ts>] Electron launch (parent pid …)` banner with no follow-up output in `~/.pi/dashboard/server.log`. The user works around it by opening a `pi` CLI session, which lets the bridge extension spawn the server with a real Node binary.

Verified in shipped `v0.5.3` `app.asar`: zero references to `ELECTRON_RUN_AS_NODE`; `e.nodeBin ?? process.execPath` confirmed in the inlined `launchDashboardServer` body.

## What Changes

- `packages/electron/src/lib/launch-source.ts` `spawnFromSource()`: pass an explicit `nodeBin` to `launchDashboardServer`, selected via a new pure helper `pickNodeForServer({ bundledNodeDir, systemNode, processExecPath })` that prefers the **bundled** Node (`<app>/Contents/Resources/node/bin/node` on macOS/Linux, `<app>\resources\node\node.exe` on Windows) and falls back to a version-safe system Node only when the bundled binary is missing.
- `packages/electron/src/lib/server-lifecycle.ts` legacy V1 `launchServer()`: same change applied to the legacy path so both V1 and V2 reach the same `nodeBin` outcome.
- Add a defence-in-depth env stamp: when the selected `nodeBin` resolves to `process.execPath` (Electron binary), set `ELECTRON_RUN_AS_NODE=1` in the spawn env so the child runs as Node instead of re-launching the GUI. This keeps the launcher correct even if a future refactor removes the bundled-node bundle.
- Repo-lint addition (`packages/shared/src/__tests__/no-electron-execpath-spawn.test.ts`): forbid call sites in `packages/electron/src/lib/**` that call `launchDashboardServer` without one of `nodeBin:` or `ELECTRON_RUN_AS_NODE` in the merged env. Pin the allowlist to `pick-node.ts` only.

No bridge / CLI / restart-helper changes — those already pass a real Node binary path.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `server-launch`: add a requirement that Electron callers MUST pass an explicit `nodeBin` (bundled-first, system-fallback) and MUST NOT rely on the `process.execPath` default when the host runtime is Electron. Pin via the new no-electron-execpath-spawn lint.
- `electron-launch-source`: extend the `spawnFromSource` contract scenario to assert `opts.nodeBin` is set to a real Node binary path and `process.execPath` is never used unguarded.

## Impact

- **Code**: `packages/electron/src/lib/launch-source.ts`, `packages/electron/src/lib/server-lifecycle.ts`, new `packages/electron/src/lib/pick-node.ts` (pure), new repo-lint test.
- **Spec files**: deltas to `openspec/specs/server-launch/spec.md` and `openspec/specs/electron-launch-source/spec.md`.
- **Build / packaging**: none. Relies on the existing `bundled-node-runtime` capability — `Resources/node/bin/node` already ships in the installer.
- **Backward compatibility**: pure fix. Existing successful launches keep working — only the silent-failure path changes. No config-schema, no API, no manifest changes.
- **Tests**: new unit test for `pickNodeForServer` resolver; the new repo-lint; update existing `launch-source.test.ts` / `server-lifecycle.test.ts` fixtures to assert `nodeBin` is supplied.
