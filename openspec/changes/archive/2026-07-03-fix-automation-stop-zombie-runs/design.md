## Context

Automation runs are spawned headless by the automation plugin via the trusted `spawnSession` host hook. A run's lifecycle in `engine.ts`:

```
startRunFor(automation):
  storeStartRun(...)          // status "running" persisted → Stop button live
  enqueuePending(ctx)         // ctx.sessionId = undefined
  spawnSession(...).then(...) // async; resolves with { success, spawnToken? }
        │
        ▼ (later, driven by ctx.onEvent in index.ts)
  session_register → linkByToken → onSessionRegisteredForRun → ctx.sessionId set
```

`engine.stopRun(runId)` today:

```ts
if (ctx.sessionId && deps.abortSession) deps.abortSession(ctx.sessionId); // skipped pre-register
finishAndRelease(ctx, { status: "error", result: "_(stopped by user)_", error: "stopped by user" });
```

Runs are spawned as **persistent** sessions: `spawnHeadless` → `buildHeadlessPiArgs` = `["--mode", "rpc", …]`. `--mode rpc` does not self-exit on `agent_end` (that is a turn boundary, not a process exit), so a completed run's session idles until server shutdown unless the plugin ends it.

Three host termination primitives exist:

| Primitive | Semantics | Keyed by | Used by |
|---|---|---|---|
| `closeSession` | closes WS only — **leaves pi alive** | sessionId | (not suitable) |
| `{type:"shutdown"}` WS msg | graceful pi process exit | sessionId | manual "close session" (`session-api.ts`) |
| `abortSession` → `{type:"abort"}` | graceful turn-halt, no process kill | sessionId | automation `stopRun` (today) |
| `headlessPidRegistry.killBySessionId()` | hard SIGTERM→2s→SIGKILL, keeper-aware | sessionId | `force_kill` / `kill_process` / shutdown |

The registry stores each entry at spawn time with `pid` + `spawnToken`; `sessionId` is linked only on `session_register` (`linkByToken`/`linkByPid`). So before register, an entry is findable by `spawnToken` but **not** by `sessionId`.

Both reported symptoms — "finished session isn't ended" and "Stop doesn't kill" — are the same missing lifecycle step: the plugin never terminates the session it spawned. This change adds that step and invokes it on both exits (completion and Stop).

## Goals / Non-Goals

**Goals**
- A completed run's persistent rpc session is ended (no idle pi left after `agent_end`).
- Stop terminates the actual pi process in every run state, including the spawn→register window.
- The run record is not finalized on a no-op abort.
- Idempotency with `agent_end` capture is preserved.

**Non-Goals**
- No UI/board change, no concurrency-policy change, no result-capture change.
- Not removing `abortSession` (other callers keep it).

## Decisions

### D1 — Kill by process handle, not by soft WS abort (Stop path)
Automation Stop must use the hard-kill ladder (`killBySessionId` / new `killByToken`), because the failure mode is a surviving process, not a stuck turn. Optionally send the soft `{type:"abort"}` first when the session is live (lets an in-turn agent stop gracefully), then rely on the kill ladder as the guarantee. The completion path (D3b) instead prefers graceful `{type:"shutdown"}` since the work already finished.

### D2 — Carry `spawnToken` on the run context
`spawnSession(...)` already returns `spawnToken`. Store it on `RunContext` in the `.then` of `startRunFor`. This gives Stop a process handle **before** any sessionId exists — the fix for the pre-register zombie. When a spawn returns no token (non-keeper legacy path), Stop falls back to the sessionId path (behaviour unchanged for those runs).

### D3 — Single host hook `abortAutomationRun`, trust-gated, serves both exits
Expose one hook on `ServerPluginContext`, gated `priority <= 100` like `spawnSession`/`abortSession`:

```
abortAutomationRun({ sessionId?, spawnToken?, graceful? }): Promise<boolean>
  if graceful && sessionId → sendToSession(sessionId, {type:"shutdown"})   // clean-exit hint
                             then killBySessionId(sessionId)              // MANDATORY escalation
  else if sessionId linked → killBySessionId(sessionId)                    // hard
  else if spawnToken       → killByToken(spawnToken)                       // pre-register hard
  else                     → false
```

The `graceful` branch mirrors the host's proven manual-close path `handleShutdown` (`session-action-handler.ts`), which never trusts the `{type:"shutdown"}` hint alone: `sendToSession` returns `false` when the bridge WS is not `OPEN` (reconnect/pre-register window), so the hint is silently dropped and a `--mode rpc` session keeps idling. The `killBySessionId` ladder (SIGTERM→2 s→SIGKILL) is the guarantee; the shutdown hint just lets a live bridge exit cleanly first (its own `process.exit(0)` safety net fires at 500 ms). Escalation is **not optional**.

One hook, two callers: normal completion calls it `graceful: true`; Stop calls it hard. Keeps all pid-registry access inside the host (untrusted plugins can't kill arbitrary pids). `killByToken` is a thin mirror of `killBySessionId` resolving the entry via the stored token.

### D3b — Terminate on normal completion
`engine.onSessionEnded` currently does `finishAndRelease` and stops. Add a termination call **after** result capture: `abortAutomationRun({ sessionId, spawnToken, graceful: true })`. `graceful` sends the clean-exit `{type:"shutdown"}` hint AND escalates via `killBySessionId` (mandatory, per D3) — the graceful hint alone is undeliverable during a bridge reconnect window and would leave the persistent rpc session idling. Termination runs after `removePending`, so any self-triggered end signal is a no-op (idempotency preserved).

### D4 — Finalize after kill, keep idempotency
`stopRun` awaits/attempts the kill, then `finishAndRelease` (removePending → later `agent_end` is a no-op via `findBySession` miss, exactly as today). Because `stopRun` becomes async, the route handler already `await`s the hook; `engine.stopRun` returns a `Promise<boolean>` — false only when the run is unknown/already finalized (unchanged contract for the "not running" 400).

### D5 — Ignore-vs-honor the abort return
The prior soft abort's boolean is now irrelevant to correctness: the kill ladder is the guarantee. We finalize once the kill has been *attempted* (the ladder itself escalates to SIGKILL), rather than gating finalization on a WS send that may transiently fail.

## Risks / Trade-offs

- **Async stopRun**: makes the engine method a promise. The route (`routes.ts` POST `/stop`) is already an `async` handler and the hook signature (`stopRun?: (args) => …`) can return a promise; the client already `await`s the fetch. Low risk.
- **Double-kill**: if a run stops just as it ends naturally, `killByToken`/`killBySessionId` targets an already-dead pid → the ladder is a no-op (returns false / kills nothing). Harmless.
- **Missing spawnToken**: legacy/non-keeper spawns without a token fall back to the sessionId path — same behaviour as today (still vulnerable to the pre-register window, but no worse). Keeper-mode spawns (the default) always carry a token.
- **Kill vs. graceful abort**: hard kill loses any in-flight graceful shutdown the agent might do. Mitigated by sending the soft abort first when the session is live (D1), escalating only as the guarantee.

## Migration / Rollout

Pure server-side behaviour change; no schema or protocol version bump. Existing stopped-run records are unaffected. No client rebuild required beyond the plugin.

## Open Questions

_(resolved)_

- **Soft `{type:"abort"}` before the Stop kill?** No. Stop uses immediate hard-kill — automations have no human at the keyboard, and partial-result capture on Stop is out of scope. The `abortSession` dep is consequently dropped from the engine's stop path (see tasks 3.5).
- **Graceful completion — shutdown hint alone or with escalation?** With escalation, mandatory. Verified: `{type:"shutdown"}` reliably exits an rpc session (bridge `shutdown()` → `cachedCtx.shutdown()` + `process.exit(0)` 500 ms safety net) **only when the bridge WS is connected**; it is dropped during reconnect/pre-register. The host's own `handleShutdown` always pairs the hint with `killBySessionId`, so completion does the same.
