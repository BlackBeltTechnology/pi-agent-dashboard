# DOX — packages/server/src/lifecycle

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `boot-parent-liveness.ts` | Boot-parent liveness + live-ppid reader for `/api/health`. → see `boot-parent-liveness.ts.AGENTS.md` |
| `dashboard-source-decision.ts` | Pure decision: stamp `source:"dashboard"` on `session_register`? Exports `decideDashboardSource(input)` →… → see `dashboard-source-decision.ts.AGENTS.md` |
| `home-lock-release.ts` | Installs SIGINT/SIGTERM/SIGHUP/SIGBREAK + `exit` handlers that release the per-HOME dashboard lock exactly… → see `home-lock-release.ts.AGENTS.md` |
| `home-lock.ts` | Per-HOME advisory lock ensuring one dashboard instance per `<canonicalHomedir>/.pi/`. → see `home-lock.ts.AGENTS.md` |
| `launch-source-effective.ts` | `computeEffectiveLaunchSource({raw, activeBridgeCount, uptimeMs})` → `LaunchSourceEffective`… → see `launch-source-effective.ts.AGENTS.md` |
| `recovery-server.ts` | Pure `node:http` recovery server. `startRecoveryServer({port, error})` spawned by `cli.ts` `runForeground`… → see `recovery-server.ts.AGENTS.md` |
