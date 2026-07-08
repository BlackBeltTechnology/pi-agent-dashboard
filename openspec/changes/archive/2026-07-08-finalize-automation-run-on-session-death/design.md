# Design — finalize automation runs on session death

## Context

Automation runs are spawned as persistent `--mode rpc` pi sessions. The engine
(`packages/automation-plugin/src/server/engine.ts`) tracks each run from
spawn → register → end, and finalizes via a single seam: `onSessionEnded` →
`finishAndRelease` → `storeFinishRun` (writes `result.md` + terminal status) and
`runner.completeRun(key)` (frees the concurrency slot). Two terminal triggers
feed `onSessionEnded` today:

1. `agent_end` — for prompt-dispatch and any run that produces an agent turn.
2. a forwarded declared **completion** event (`flow_complete`, from pi-flows'
   `flow:complete` via the extension `FLOW_EVENT_MAP`) — for headless
   event-dispatch runs that emit no `agent_end`. Added by change
   `finalize-event-dispatched-automation-runs`.

Both triggers are **forwarded-event** paths. Neither fires if the run's session
process exits / tears down its bridge WebSocket before the event is forwarded.

### The proven race

`flows.run` delivers `flow:run` into the session; pi-flows runs the flow
headlessly. For a **code-only** flow (`type: code` steps only — e.g.
`invoicebot:pull`'s `pullAll`), the flow can finish and the session can exit in
the same tick the terminal `flow:complete` is emitted:

```
flow:run delivered ─▶ code-only flow runs (~ms)
                              │
              ┌───────────────┴────────────────┐
              ▼                                 ▼
  flow:complete forwarded            session exits / WS closes
  BEFORE close  → onSessionEnded      BEFORE flow:complete forwarded
  → finishRun (status: done)          → gateway logs "connection closed" +
                                        "heartbeat timeout … grace period"
                                        → nothing touches the automation run
                                        → run stuck "running" FOREVER
                                        → runner.active never cleared
                                        → concurrency:skip drops every fire
```

Measured on the live project: pull runs split **3 done / 7 stuck** — a coin-flip
on which side of the teardown the forwarded event lands. Runs with `agent` steps
(`invoicebot:process`) never wedge: the agent turn keeps the session alive for
seconds and ends with a clean `agent_end` handshake, so a terminal event always
wins.

The killer detail: **the server already detects the death.** The gateway emits
`connection closed` and `heartbeat timeout but session still active, grace
period`. That grace period is correct for a human session that may reconnect. It
is exactly wrong for a one-shot headless `kind="automation"` run, which will
never reconnect. The finalize seam is simply not wired to the close signal.

## Goals / Non-Goals

**Goals**
- No automation run can remain `running` forever because a terminal event was
  lost in a teardown race.
- Finalize is triggered by the signal the server *already has* (session death),
  not only by best-effort forwarded events.
- A hard backstop (reaper) guarantees eventual finalization on any transport.
- Zero behavior change for prompt-dispatch and `agent_end`-terminated runs.

**Non-Goals**
- Guaranteeing the run *result* survives teardown (a pre-exit event flush) — a
  separate follow-up; out of scope. This change guarantees *finalization*, not
  result fidelity.
- Changing `concurrency` policy semantics. `skip` stays the default; the freeze
  is fixed at the finalize layer, not the policy layer.
- Rearchitecting the human-session reconnect-grace path for non-automation
  sessions.

## Decisions

### D1 — Finalize headless automation runs on session death, not only on forwarded events (primary, fix A)
Route the gateway's no-reconnect close for a `kind="automation"` session into the
engine's existing `finishAndRelease`. The engine finalizes once: last-known
buffered result if present, else `status: error` with reason
`session ended before completion`. Reuses the idempotent finalize/terminate path,
so a late `flow_complete`/`agent_end` is a no-op.
- *Why:* acts on the close signal the server already sees; closes the proven gap
  at its source with the smallest seam. The reconnect-grace path is suppressed
  for headless automation sessions because they never reconnect.
- *Alternative rejected:* only flush events before teardown (fix C). Ordering-
  sensitive and unprovable across all exit paths; does not finalize a run that
  died mid-flight.

### D2 — Stale-run reaper as a transport-independent backstop (fix B)
A `running` automation run older than a configurable ceiling is transitioned to
`error` and its slot freed via `completeRun`, swept on a timer and/or on each
fire for the key.
- *Why:* guarantees no lost terminal event is ever *permanent*, even if D1 misses
  an exotic exit path. Cheap, self-contained, idempotent with D1 and `agent_end`.
- *Alternative rejected:* rely on D1 alone. D1 is the targeted fix, but a
  belt-and-braces reaper is what turns "should not orphan" into "cannot stay
  orphaned."

### D3 — `concurrency` choice is an operator mitigation, not the fix (fix D)
Documented that a code-only `flows.run` MAY use `queue`/`parallel` to self-heal
on the next fire. Not encoded as a spec requirement here.
- *Why:* it hides the symptom (schedule recovers) but leaves the orphaned record
  and never addresses the lost-finalization root cause. Useful as a one-line
  stopgap operators can apply today while D1+D2 land.

## Fix ranking (against the proven cause)

| Fix | Closes proven gap | Notes |
|-----|-------------------|-------|
| A. Finalize on session death for headless `kind=automation` | ✅ directly | server already has the close signal; wire it to `onSessionEnded` |
| B. Stale-run reaper (`running` → `error` + `completeRun`) | ✅ backstop | no permanent orphan on any transport |
| C. Flush forwarded events before teardown | partial | ordering-sensitive; preserves *result*, not finalization |
| D. `concurrency: queue\|parallel` for pull | self-heal only | next fire recovers; orphan record remains |

**A + B** is the robust answer. **D** is the operator stopgap. **C** is an
optional follow-up only if losing pull *work* (vs. just the record) matters.

## Migration

The 7 pre-existing `status: "running"` orphans do not self-heal. On first run of
the reaper (B) they age past the ceiling and transition to `error`; alternatively
a one-time manual sweep can clear them. No schema change to `run.json`.
