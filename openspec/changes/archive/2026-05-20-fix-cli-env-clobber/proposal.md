## Why

`packages/server/src/cli.ts` calls `launchDashboardServer({ env: { ...process.env }, … })` in `cmdStart`. This passes the raw `process.env` as the caller-override, which `launchDashboardServer` then merges **on top of** the augmented base env from `ToolResolver.buildSpawnEnv(process.env)`. The resulting `PATH` is the raw `process.env.PATH` — the resolver's PATH augmentation (prepended managed-dir, bundled-node, pi-bin) is silently clobbered.

The comment directly above the bug states:

```
// All concerns below — jiti loader resolution, --import argv URL-wrapping,
// env merge, log-file header, readiness polling, port-conflict / early-exit
// detection — are owned by the shared `launchDashboardServer` primitive.
```

The comment is correct; the code violates it.

Observable symptoms:

- `pi-dashboard start` from a fresh login shell that doesn't init nvm in non-interactive context: the spawned daemon's child cannot find `pi`. Doctor still reports pi found (Doctor uses native Node `fetch` + ToolRegistry directly, not the spawned env), so the failure is silent until a pi-dependent operation is attempted.
- On Linux with `.desktop` launchers that strip nvm paths from PATH (most common case for system-launched daemons), the spawned cli.ts cmdStart child gets PATH=`/usr/local/bin:/usr/bin:/bin` and cannot find pi.
- Electron's `spawnFromSource` does NOT have this bug — it builds env explicitly from `buildSpawnEnv` and adds only overrides (`DASHBOARD_STARTER`, optional `ELECTRON_RUN_AS_NODE`). The CLI path is the only one with the regression.

Reference: `dashboard-server` capability constraint C22 ("Env merge: `ToolResolver.buildSpawnEnv` first, caller overrides on top") and `server-launcher.ts:206-215` (the merge logic).

## What Changes

**MODIFY** `packages/server/src/cli.ts:cmdStart`

Stop passing `env: { ...process.env }`. Either omit `env` entirely (preferred — defaults flow through `buildSpawnEnv`) or pass only narrow overrides for fields that aren't already in `process.env`. The shared `launchDashboardServer` primitive already runs `buildSpawnEnv(process.env)` internally — there is no reason for the CLI to redundantly pass the raw env on top.

Concretely, change:

```ts
const result = await launchDashboardServer({
  cliPath,
  extraArgs: args,
  stdio: { logFile: logPath },
  starter: "Standalone",
  healthTimeoutMs: 30_000,
  port: config.port,
  env: { ...process.env },           // ← remove this line
});
```

The fix is one line. The shared primitive's existing behavior takes over:

1. `baseEnv = buildSpawnEnv(process.env)` — PATH augmented with managed-dir, bundled-node, pi-bin
2. `DASHBOARD_STARTER` injected when `opts.starter` is set and not already in env
3. No caller-env clobber

After the fix, the CLI's env-handling matches Electron's (`launch-source.ts:763-768`).

**ADD** `packages/server/src/__tests__/cli-env-no-clobber.test.ts`

Repo-lint test: scans `packages/server/src/cli.ts` for `env: { ...process.env }` patterns. Fails if found. Prevents regression — this exact line existed at least since the `unify-server-launch-ts-loader` archive, so a regression test is warranted.

## Impact

- 1 line removed from `cli.ts`.
- 1 new test file (~30 lines including the regression-prevention scan).
- Behavior change: daemon spawned by `pi-dashboard start` now inherits the resolver's PATH augmentation (managed-dir, bundled-node, pi-bin). Operations that depend on pi finding itself (e.g. session spawn, openspec, autoresume) work in environments where the raw process.env lacks the managed paths.
- Zero impact on the other 10 spawn paths (CLI foreground in-process, CLI restart via /api/restart, bridge auto-spawn, Electron V2's 5 sub-paths, Electron legacy, Electron loading-page/tray "Start Server"). None of them passes `env: { ...process.env }`.
- No impact on Windows-specific code paths.
- No impact on bridge contract / state distribution / quiesce / restart broadcast.

## Out of scope

- The other three bugs (workspace bin trap, update wiring, three-installs unification) — separate proposals. This is the single smallest, safest fix.
- Lifting the LaunchSource V2 resolver into shared for CLI use — orthogonal and much larger.
- Adding any new behavior to `launchDashboardServer` — the existing behavior is correct; only the CLI caller is misusing it.

## Dependencies

None. Doesn't depend on any active change. Compatible with all in-flight changes (`harvest-bootstrap-survivor-fixes`, `fix-electron-server-launch-node-bin`, `fix-electron-auto-update-pipeline`, etc.).
