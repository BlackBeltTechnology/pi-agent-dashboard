# Fix worktree server auto-start leak

## Why

A pi session running in a git worktree resolves the dashboard server CLI relative to its OWN extension copy (`server-launcher.ts:56` `resolveServerCliPath()`), so bridge auto-start spawns a detached server from `.worktrees/<name>/packages/server/src/cli.ts` on the shared `--port 8000 --pi-port 9999`. Losers of the resulting bind race stay resident without a listener, and a winner that grabs loopback `:9999` hijacks bridge registrations from the real dashboard — observed as sessions that register normally then 502 `no bridge connection` on every prompt.

Observed on 2026-08-13: seven stale servers on one host — five identical copies from `os-purge-replay-cache-on-reset-paths` (port-less zombies, ~3h24m old), one from `os-add-blackhole-plugin` (3 days old), and one from `os-add-dashboard-mcp-server` holding `127.0.0.1:9999` against the main server's `*:9999`. Killing them took `activeBridgeCount` from 0 → 8 immediately, confirming bridges had been captured by the stale server.

## Evidence — reproduced 2026-08-13 08:45 (state captured before kill)

The defect recurred and was captured live rather than inferred. PID 78379, started 02:53:35, observed at 08:45 — **5h52m resident**:

```
cmd   .worktrees/os-fix-kb-search-retrieval-quality/packages/server/src/cli.ts --port 8000 --pi-port 9999
held  127.0.0.1:9999  (LISTEN)     <- gateway, stolen from the real dashboard
held  127.0.0.1:65348 (LISTEN)
NOT   *:8000 / 127.0.0.1:8000      <- never bound its dashboard port
state RSS 316 MB, CPU 1:25 cumulative, event loop alive, exited cleanly on SIGTERM
```

Meanwhile PID 10622 held `*:8000` + `*:9999` and answered `/api/health` with HTTP 200. Both gateway binds coexisted because a loopback-specific bind does not collide with a wildcard bind, and **the more specific bind wins for `localhost` connections** — so every bridge dialing `localhost:9999` reached the worktree process.

End-to-end symptom, from `keeper-518c92c5-….log`: a session spawned by the real dashboard at 08:43:51 logged `keeper ready` 0.3s later, never produced a card, and was SIGTERMed at 08:45:22. The dashboard spawned it correctly; its bridge simply registered with a server that serves nothing.

Two facts contradict this change's original diagnosis and drive the revised requirement:

1. **The process never exited**, so this is not "a failed bind that forgets to exit". It either failed between `:1828` and `:2099` without the rejection reaching `main().catch`, or it hung there and never attempted the dashboard bind. 1:25 of cumulative CPU over 6h is consistent with an idle timer loop, not a crash.
2. **Listener teardown alone would not have fixed it.** Closing the gateway socket does not end a process whose event loop is held open by timers (`pi-gateway.ts:214` `pingTimer`).

## What Changes

- **A server that never reaches serving state must not survive**: now **reproduced** (see Evidence). The captured process bound the pi gateway, **never bound its dashboard port**, and stayed resident 5h52m with a live event loop — never reaching `cli.ts:573-577` `main().catch → process.exit(1)` at all. `piGateway.start(config.piPort)` runs at `server.ts:1828`, far ahead of `fastify.listen()` at `:2099`; anything that fails **or hangs** between those points yields a process holding `:9999` and serving nothing. The requirement therefore covers a startup that fails *and* one that never completes — not merely handle teardown on a rejection.
- **Single-flight auto-start**: `autoStartServer()` SHALL acquire a per-user lock before spawning, so concurrent sessions cannot each pass their own health check and all spawn (TOCTOU — the five observed copies started 4-22s apart).
- **Worktree refusal**: auto-start SHALL refuse to spawn when the resolved server CLI path lies inside a `.worktrees/` directory AND either the dashboard port or the pi-gateway port is the shared default. Keying on the dashboard port alone would let `--port 8001 --pi-port 9999` evade refusal and still hijack the gateway. A worktree session should consume a dashboard, never become one.
- Diagnostics: the refusal and the lock-loss path SHALL be written to a durable log file, so the next occurrence is greppable rather than re-derived from `lsof`. `notify` is a transient TUI toast and does not satisfy this.

Not in scope: pruning the several hundred stale entries in `.worktrees/` (housekeeping, and `os-sweep-worktree-residual-on-remove` already covers residual sweep).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-auto-start-lifecycle` — adds the single-flight lock requirement and the worktree-path refusal to the discovery → health-check → spawn chain.
- `server-launch` — adds the requirement that a server which never reaches serving state exits rather than lingering (covering both failure and hang), plus a distinguishable port-conflict exit status for the spawning parent.

## Impact

- `packages/extension/src/server-auto-start.ts` — lock acquisition, worktree refusal, log lines.
- `packages/extension/src/server-launcher.ts` — `resolveServerCliPath()` gains a worktree predicate; spawn args unchanged.
- `packages/server/src/server.ts` — the `start()` failure path between `piGateway.start` (`:1828`) and `fastify.listen` (`:2099`).
- `packages/server/src/cli.ts` — `guardTempHomePort` (`:131-147`) already remaps `8000→0` under a temp HOME; its predicate and the new refusal predicate must be reconciled, not left to interact by accident.
- Interaction with `server-startup-recovery`: the recovery server has its own `EADDRINUSE` handler exiting **2** (`recovery-server.ts:411`), so a parent distinguishing port conflicts must accept both 2 and the new code.
- Risk: an over-eager worktree refusal breaks the legitimate isolated-verification flow, which deliberately runs a worktree dashboard on NON-default ports. The refusal must require a default port on one of the two dimensions, not worktree-ness alone.

## Discipline Skills

- `systematic-debugging` — the lingering-server defect was originally inferred, then **reproduced on 2026-08-13** with process state captured before the kill (see Evidence). The reproduction falsified the first diagnosis: the process never exited and never bound its dashboard port, so a bind-failure exit path would not have prevented it.
- `observability-instrumentation` — the diagnostics bullet; this failure was invisible until `lsof` + `activeBridgeCount` were correlated by hand.
- `doubt-driven-review` — the worktree refusal changes when a dashboard comes into existence at all, and can strand a developer with no server.
