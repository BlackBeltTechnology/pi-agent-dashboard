## Why

A subagent card keeps spinning after its subagent has already stopped. The `Agent` card's running/done state is driven by ONE event, the parent's `tool_execution_end` for that call. That frame is transcript-class: the browser gateway sheds it when the socket is backed up (`browser-gateway.ts` `sendTo` drops when `bufferedAmount > MAX_WS_BUFFER`). The client does no seq-gap detection (`useMessageHandler.ts` `case "event"` only raises `maxSeq`), so a shed end goes unnoticed. On this machine `/api/health` reports 395 shed frames this run, 370 in one session with parallel subagents, and the server log shows past runs with 924+.

Two other stop signals already reach the client and are ignored by the card:

- `subagent_completed` / `subagent_failed` — a separate carrier from the producer, already reduced into `SessionState.subagents` but never applied to the card row.
- `agent_settled` — pi's single terminal signal for the parent run. A foreground `Agent` call cannot outlive it, so any `Agent` card still `running` afterwards is stale by construction.

Today a shed end heals only through the stale-tool HTTP reconcile (`useStaleToolReconcile`: rows older than 25s, then every 15s), or through the supersede heal after the NEXT assistant inference. Meanwhile a finished subagent spins next to its still-running siblings. That is the reported "completed subagent not shown while another one runs" symptom.

## What Changes

- **Subagent stop finalizes its card.** The client finalizes the still-running top-level `Agent` row as soon as it knows the subagent stopped. That is either when `subagent_completed`/`subagent_failed` arrives for the agent id the row carries, or when a progress tick links a running row to an agent id already known to be finished.
  - The row and its `toolCalls` entry go complete (or error), `toolDetails.status` becomes `completed`/`error` (the card's vocabulary; `failed` would render as running), and the card shows the subagent's own result or error text.
  - The row is stamped `healedBy:"subagent_stopped"`, or the trigger's own marker such as the server's `session_ended`.
  - A later real `tool_execution_end` overwrites it.
  - Measured: `subagent_completed` arrives about 10 ms before the parent end on every call, so this runs on the normal path too and the real end immediately replaces it. On a shed end, it is the fix.
- **Parent settle finalizes any leftover.** On `agent_settled`, every top-level `Agent` row still running is finalized and stamped `healedBy:"turn_settled"`.
  - It uses the subagent's terminal state and result when known.
  - Otherwise it shows a neutral "subagent stopped — result not received" body with the recovered badge, and does not record the subagent as completed. Its `toolCalls` entry stays running, so the existing HTTP stale-reconcile can still fetch the real result and replace the neutral body.
  - `agent_end` alone does not trigger it.
- **A finished subagent's card stays finished.** A late progress tick no longer reopens an `Agent` row whose subagent the client knows has completed or failed. Only stats merge. A trailing `running` tick can land between `subagent_completed` and the parent end, because the bridge throttle discards held ticks only at the tool end.
  - Applies when the subagent is known finished, or when the row was finalized by the turn settle (a foreground call cannot outlive the settle). The tick still replaces the details; only the terminal fields are re-asserted, which keeps the server's update-collapse premise. A replay orphan-close of a still-running call is unaffected.
  - A real end also clears the heal-only fields (`resultMissing`, a heal-sourced `error`). The open card's resync cadence stops once the row is finalized.
- **Recovered badge** for the neutral settle heal. The same helper also badges `session_ended`, which `subagent-live-timeline` already requires and `ToolCallStep` lacks.
- Everything goes through the existing end arm: running-only guard, trigger-event timestamp, never an empty result (so a stale progress line can't stick).

Out of scope:
- Client seq-gap detection + backfill (the general fix for any shed frame, and the only way to recover a shed end's real body after a neutral settle heal).
- Server stalled-socket termination.
- `currentTool`/session-status correctness for parallel calls.
- Non-`Agent` rows.
- The subagents producer upgrade.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `subagent-live-detail-reliability`: adds requirements so the `Agent` card is finalized by the subagent's own terminal event and by the parent run's settle, independent of the parent `tool_execution_end`, and is not reopened by a late tick once its subagent is known finished.
- `agent-tool-rendering`: "Structured partialResult handling in event reducer" gains the finished-subagent exception (stats-only merge).

## Impact

- `packages/client/src/lib/chat/event-reducer.ts` — `subagent_completed`/`subagent_failed`, `tool_execution_update` and `agent_settled` arms, plus one shared finalize helper that reduces a synthesized end through the existing `tool_execution_end` arm.
- `packages/client/src/components/chat/ToolCallStep.tsx` — recovered badge for `resultMissing` and `session_ended`.
- `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx` — the resync cadence's `running` input is gated on the row status.
- Tests: `packages/client/src/lib/__tests__/event-reducer.subagent-stop.test.ts` (new), `ToolCallStep` / `AgentToolRenderer` tests.
- No server, bridge, protocol or producer change. Rebuild: client build + restart.

## Discipline Skills

- **`review-code`** — reducer change on a hot, heavily-specified path; review the diff before commit.
- **`systematic-debugging`** — only if a heal ever regresses a real terminal row in tests (guard interplay with the superseded/session_ended/evicted heals).

`security-hardening`, `performance-optimization`, `observability-instrumentation` and `doubt-driven-review` do not apply: client-only state derivation, no untrusted input, no new endpoint, O(session rows) scan on `subagent_*` terminal events and `agent_settled`, rare compared to ticks; the tick-path check is an O(1) map lookup.
