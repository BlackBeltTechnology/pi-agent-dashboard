# DOX — packages/server/src/rpc-keeper

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `dispatch-router.ts` | Handles `dispatch_extension_command`: writes pi RPC line to keeper UDS, emits optimistic `command_feedback` (persist + broadcast). Exports `buildPiRpcLine` (pure), `handleDispatchExtensionCommand`, `DispatchRouterContext`. Never throws; failures surface as `command_feedback {status:"error"}`. |
| `keeper-manager.ts` | `spawnKeeperFor(sessionId, cwd, env, sessionFile?, piCmd?)` spawns per-session keeper sidecar; JSON-encodes resolved `piCmd` into keeper env as `PI_KEEPER_PI_CMD` when non-empty. See change: fix-rpc-keeper-pi-resolution. |
