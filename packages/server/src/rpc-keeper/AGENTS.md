# DOX — packages/server/src/rpc-keeper

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `dispatch-router.ts` | Handles `dispatch_extension_command`: writes pi RPC line to keeper UDS, emits optimistic `command_feedback` (persist + broadcast). Exports `buildPiRpcLine` (pure), `handleDispatchExtensionCommand`, `DispatchRouterContext`. Never throws; failures surface as `command_feedback {status:"error"}`. |
| `keeper-manager.ts` | `spawnKeeperFor(sessionId, cwd, env, sessionFile?, piCmd?)` spawns per-session keeper sidecar; JSON-encodes resolved `piCmd` into keeper env as `PI_KEEPER_PI_CMD` when non-empty. Sets `ELECTRON_RUN_AS_NODE=1` on `keeperEnv` when `nodeBinary` is Electron execPath (`electronAsNodeRequired`), guarding the keeper's own `[nodeBinary, keeper.cjs]` launch independently of the pi argv. See changes: fix-rpc-keeper-pi-resolution, fix-nodescript-argv-electron-execpath-fallback. Adds `isKeeperAlive(sessionId)` — side-effect-free per-session probe (pid sidecar via `pidPathFor` + keeper PID + `isPiAliveForSession`), used by the resume guard; unlike `discoverExistingKeepers` it never unlinks or kills. See change: fix-recovery-exit-intent. |
