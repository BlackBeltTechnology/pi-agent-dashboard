## Why

The automation run lifecycle never terminates the session it spawns. Automation runs are `pi --mode rpc` — **persistent, multi-turn** sessions that do not self-exit when a turn ends. Nothing in the plugin closes them, so live pi processes accumulate on **both** the completion path and the Stop path, reaped only at server shutdown (`killAll`) — the "automation is unstable, Stop is not working" symptom.

Three defects, all the same missing step ("end the session"), confirmed by code audit (`packages/automation-plugin/src/server/engine.ts`, `packages/server/src/process-manager.ts`, `packages/server/src/server.ts`, `packages/server/src/headless-pid-registry.ts`, `packages/server/src/pi-gateway.ts`):

1. **A finished run's session is never ended.** `spawnHeadless` builds `["--mode", "rpc", …]` (persistent). On completion the run session emits `turn_end` → `agent_end`; `engine.onSessionEnded` calls `finishAndRelease` (writes the run record, drains the queue) and **stops there** — it never closes or kills the pi process. `agent_end` means "turn ended", not "process exit", so the rpc session idles forever.

2. **Stop during the spawn→register window is a no-op abort.** `startRunFor` writes a `running` record (Stop button goes live) the instant it spawns, but `ctx.sessionId` is only bound later, when the spawned session registers and its first event is correlated. If Stop lands in that window, `engine.stopRun` finds the run but — because `ctx.sessionId` is `undefined` — **skips `abortSession` entirely**, finalizes the record, and `removePending`s it. The pi process then finishes booting, registers, gets **no prompt** (already removed from `pending`) and is **never signaled** → an orphan headless session.

3. **The abort path is a soft, fire-and-forget turn-halt — not a process kill.** Even when `ctx.sessionId` is set, automation Stop uses `abortSession` → `{ type: "abort" }` WS message → bridge `cachedCtx.abort()` (a graceful "halt current turn"). It (a) returns `false` from `sendToSession` when the bridge WS is not `OPEN` (reconnect window) — and `engine.stopRun` **ignores that return value**, finalizing anyway; and (b) has **no SIGTERM→SIGKILL escalation**, so a wedged agent (not in an abortable turn) survives.

The host already ships the primitives needed: a graceful `{ type: "shutdown" }` WS message (used by the manual "close session" path, `session-api.ts`) for the happy-path exit, and `headlessPidRegistry.killBySessionId()` (SIGTERM→2s→SIGKILL, keeper-aware) as the guaranteed hammer. **Automation reaches for neither.** The registry also stores every session's `pid` + `spawnToken` from the moment of spawn, so termination is feasible even before the session registers.

## What Changes

Give the automation lifecycle a single owned "terminate this run's session" step, invoked on **both** exits.

- **Thread the `spawnToken` onto the run context.** `spawnSession` already returns a `spawnToken`; store it on the automation `RunContext` so termination always has a process handle independent of WS/sessionId registration.
- **Add a token-keyed hard kill to the pid registry**: `killByToken(spawnToken)` — a mirror of `killBySessionId` that resolves the entry by the `spawnToken` the registry already stores, so a run can be killed during the pre-register window.
- **Expose a trusted host hook `abortAutomationRun({ sessionId?, spawnToken?, graceful? })`** on `ServerPluginContext` (same trust gate as `spawnSession`/`abortSession`). `graceful: true` sends `{ type: "shutdown" }` to a live session for a clean exit; otherwise (or as escalation) it hard-kills via `killBySessionId(sessionId)`, falling back to `killByToken(spawnToken)` when no sessionId is linked.
- **Terminate on normal completion.** After `onSessionEnded` captures the result on `agent_end`, the engine calls the hook (`graceful: true`) to end the now-idle rpc session — closing defect 1.
- **Rework `engine.stopRun`** to call the hook (hard-kill, falling back to `spawnToken` when `ctx.sessionId` is unknown) and only finalize the record after termination has been attempted — closing defects 2 & 3.
- **Keep finalization idempotent** with the `agent_end` path (unchanged contract): a run is finalized exactly once; a self-triggered `agent_end`/exit after termination is a no-op via `removePending`.

Non-goals: changing the board UI, the concurrency/queue policy, or the result-capture path. This change is confined to making the lifecycle actually end the process on both exits.

## Capabilities

### Modified Capabilities
- `automation-run-lifecycle`: (a) The "A running run can be stopped by the user" requirement currently mandates stopping via `abortSession(sessionId)` only — modify it to require a **process-terminating** stop that works in the spawn→register window (before a sessionId exists) via a `spawnToken`-keyed kill, and that does not finalize on a no-op abort. (b) Add a new requirement that a run finalized by normal `agent_end` completion **SHALL terminate its spawned session** (the persistent `--mode rpc` session does not self-exit). Add scenarios for the pre-register window, the soft-abort-returns-false case, and the completed-run session termination.

## Impact

- **Automation plugin**: `packages/automation-plugin/src/server/engine.ts` (`RunContext` gains `spawnToken`; `startRunFor` stores it from the spawn result; `onSessionEnded` terminates the session after capture; `stopRun` calls the hook + finalizes after kill), `packages/automation-plugin/src/server/index.ts` (wire `abortAutomationRun` from `ctx`).
- **Host**: `packages/server/src/headless-pid-registry.ts` (`killByToken`), `packages/server/src/server.ts` (`abortAutomationRun` hook on the plugin context, trust-gated, graceful `{type:"shutdown"}` + kill fallback), `packages/dashboard-plugin-runtime/src/server/server-context.ts` (type + passthrough for the new hook).
- **Shared**: spawn hook result already carries `spawnToken`; no protocol change expected. New `ServerPluginContext.abortAutomationRun` type.
- **Tests**: `routes-stop.test.ts`, `engine.test.ts` (completed run terminates its session; pre-register stop kills by token; soft-abort-false does not orphan), plus a `killByToken` unit test in the server package.
- **Backward compatible**: `abortSession` stays for other callers; automation stops relying on it as its only tool. Runs whose spawn returned no `spawnToken` fall back to the sessionId path.
