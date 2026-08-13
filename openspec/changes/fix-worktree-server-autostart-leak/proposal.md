# Fix worktree server auto-start leak

## Why

A pi session running in a git worktree resolves the dashboard server CLI relative to its OWN extension copy (`server-launcher.ts:56` `resolveServerCliPath()`), so bridge auto-start spawns a detached server from `.worktrees/<name>/packages/server/src/cli.ts` on the shared `--port 8000 --pi-port 9999`. Losers of the resulting bind race stay resident without a listener, and a winner that grabs loopback `:9999` hijacks bridge registrations from the real dashboard — observed as sessions that register normally then 502 `no bridge connection` on every prompt.

Observed on 2026-08-13: seven stale servers on one host — five identical copies from `os-purge-replay-cache-on-reset-paths` (port-less zombies, ~3h24m old), one from `os-add-blackhole-plugin` (3 days old), and one from `os-add-dashboard-mcp-server` holding `127.0.0.1:9999` against the main server's `*:9999`. Killing them took `activeBridgeCount` from 0 → 8 immediately, confirming bridges had been captured by the stale server.

## What Changes

- **Startup-failure teardown**: when startup fails after the pi-gateway listener is up, the server SHALL tear down its pre-listen handles so the process cannot linger. `piGateway.start(config.piPort)` runs at `server.ts:1828`, well before `fastify.listen()` at `:2099`; a failure between those points leaves a process holding `:9999` with no dashboard — which is exactly the observed hijacker. The normal listen path already exits via `cli.ts:573-577` `main().catch → process.exit(1)`, so the defect is retained handles, not a missing exit.
- **Single-flight auto-start**: `autoStartServer()` SHALL acquire a per-user lock before spawning, so concurrent sessions cannot each pass their own health check and all spawn (TOCTOU — the five observed copies started 4-22s apart).
- **Worktree refusal**: auto-start SHALL refuse to spawn when the resolved server CLI path lies inside a `.worktrees/` directory AND either the dashboard port or the pi-gateway port is the shared default. Keying on the dashboard port alone would let `--port 8001 --pi-port 9999` evade refusal and still hijack the gateway. A worktree session should consume a dashboard, never become one.
- Diagnostics: the refusal and the lock-loss path SHALL be written to a durable log file, so the next occurrence is greppable rather than re-derived from `lsof`. `notify` is a transient TUI toast and does not satisfy this.

Not in scope: pruning the several hundred stale entries in `.worktrees/` (housekeeping, and `os-sweep-worktree-residual-on-remove` already covers residual sweep).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-auto-start-lifecycle` — adds the single-flight lock requirement and the worktree-path refusal to the discovery → health-check → spawn chain.
- `server-launch` — adds the startup-failure handle-teardown requirement, plus a distinguishable port-conflict exit status for the spawning parent.

## Impact

- `packages/extension/src/server-auto-start.ts` — lock acquisition, worktree refusal, log lines.
- `packages/extension/src/server-launcher.ts` — `resolveServerCliPath()` gains a worktree predicate; spawn args unchanged.
- `packages/server/src/server.ts` — the `start()` failure path between `piGateway.start` (`:1828`) and `fastify.listen` (`:2099`).
- `packages/server/src/cli.ts` — `guardTempHomePort` (`:131-147`) already remaps `8000→0` under a temp HOME; its predicate and the new refusal predicate must be reconciled, not left to interact by accident.
- Interaction with `server-startup-recovery`: the recovery server has its own `EADDRINUSE` handler exiting **2** (`recovery-server.ts:411`), so a parent distinguishing port conflicts must accept both 2 and the new code.
- Risk: an over-eager worktree refusal breaks the legitimate isolated-verification flow, which deliberately runs a worktree dashboard on NON-default ports. The refusal must require a default port on one of the two dimensions, not worktree-ness alone.

## Discipline Skills

- `systematic-debugging` — one defect (the lingering bind loser) is inferred from process state rather than proven from logs; the evidence was destroyed when the processes were killed. Reproduce before fixing.
- `observability-instrumentation` — the diagnostics bullet; this failure was invisible until `lsof` + `activeBridgeCount` were correlated by hand.
- `doubt-driven-review` — the worktree refusal changes when a dashboard comes into existence at all, and can strand a developer with no server.
