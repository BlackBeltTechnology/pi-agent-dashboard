## Why

`pi-dashboard stop` run under a temporary `HOME` killed the user's real dashboard on `:8000` twice on 2026-10-05: at 11:42 from the `assert-bundled-server-plugin-load.mjs` teardown, and at 16:26 from an agent's smoke-test cleanup. Both show `exitIntent: "signal"` in `boot-state.json`, which means a plain SIGTERM, not `/api/restart`. The "safety net" in `stop` SIGTERMs every process listening on the configured ports without checking who owns it. `stop` also ignores `--port` and `--pi-port`, so a temp `HOME` with no config falls back to 8000/9999, which are the live server's ports. The `debug-dashboard` skill already warns agents "Never `pi-dashboard stop` (it kills `:8000` via stale-port lsof)". This change removes that trap.

## What Changes

- **A. `stop` honors `--port` / `--pi-port`.** The stop subcommand receives the resolved CLI config (flag > env > file), the same as `start`, `restart` and `status`, including the existing temp-HOME production-port guard. The port sweep then targets exactly the ports `start` would bind, so a HOME under the OS temp dir never inspects 8000.
- **B. Ownership-scoped port sweep (BREAKING CLI behavior).** A process holding the dashboard or gateway port is killed only when this `HOME` can prove it owns it. Accepted proofs: this HOME's `server.lock.meta.json` records that pid for the swept HTTP port; or the port's `/api/health` reports this HOME's persisted `instanceId` together with that pid. The advisory `server.pid` keeps its existing kill step but is not a proof for the sweep. A holder that fails all three is reported and left running.
- **C. `--force` flag.** `pi-dashboard stop --force` restores the old behavior: kill every holder of the ports, whoever owns it. The flag is documented with explicit danger wording: it can kill a dashboard that belongs to another `HOME`, another user's session, the Electron app's server, or a non-dashboard service. It is the documented recovery for an orphaned holder that nothing on disk can identify.
- **D. Fix the known caller.** The `packages/electron/scripts/assert-bundled-server-plugin-load.mjs` teardown passes the ports it booted on (`--port`, `--pi-port`) to `stop`, so it only ever targets its own server.
- **Docs.** Every place that says `stop` "kills stale port holders" is updated: README, `docs/faq.md`, `docs/architecture.md`, and `docs/installation-windows.md` (only where its prose describes port killing), and the `debug-dashboard` / `implement` / `frontend-mockup-loop-dashboard` skill references. They now describe the ownership rule and `--force` with its dangers. The isolated-verification pitfall is reworded to match.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `server-process-management`: the "Stop subcommand" requirement gains port-flag handling, an ownership-scoped port sweep, and a `--force` override.

## Impact

- **Code:** `packages/server/src/cli.ts` (`cmdStop`, `parseArgs`, usage text) and `packages/electron/scripts/assert-bundled-server-plugin-load.mjs` (teardown argv). It reads the existing per-HOME records (`server.pid`, `server.lock.meta.json`, `instances/<piPort>.id`) and needs a non-creating instance-id read from `packages/server/src/lifecycle/instance-id.ts`.
- **CLI behavior:** `stop` without `--force` no longer kills listeners it cannot attribute to the current `HOME`. It names them in its output, plus a hint about `--force`. Exit code stays 0. Scripts that relied on `stop` to clear an unrelated port must add `--force`.
- **Unchanged:** `/api/restart`, `restart-helper.ts`, `start`, the PID-file kill path, and the platform kill primitives. `restart`'s local fallback (dashboard unreachable) now runs the scoped `stop` with the restart config. Its stop-then-start contract is unchanged. One visible difference: when a non-dashboard service holds the port, `restart` no longer kills it. `start` then reports the port conflict and exits 1, and the recovery is an explicit `stop --force`. `restart` ignores `--force`.
- **Follow-up (out of scope):** the `instance-coordination` / `home-lock-single-instance` specs require `$HOME`-immune lock paths, but the shipped `getLockPath` deliberately honours `$HOME`. This change depends on the shipped behavior and pins it with a test; the reconciliation is tracked separately.
- **Compatibility / rollback:** no persisted-format or protocol change. Rollback is a plain revert. A server from an older version that has no `instanceId` on `/api/health` is still stopped by the PID-file step, or covered by the lock sidecar.
- **Follow-up (out of scope):** `restart-helper.ts` reads `~/.pi/dashboard/dashboard.pid`, but the server writes `server.pid`. As a result the orchestrator's explicit kill step (`killPriorDaemon`) is currently a no-op. This is tracked separately.

## Discipline Skills

- `doubt-driven-review`: changes what an existing public CLI command kills. Stress-test the ownership rule (pid reuse, stale sidecar, health timeouts, Windows `USERPROFILE`) before it stands.
- `review-code`: run before commit, once the tests pass.
