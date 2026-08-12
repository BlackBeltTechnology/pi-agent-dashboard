# bound-stalled-event-run-settle

## Why

An **event-dispatched** automation run — one whose action declared an
`ActionEvent.completion` — has exactly one terminal signal on the happy path:
that declared completion event. It produces **no `agent_end`**
(`packages/flows-plugin/src/server/automation-actions.ts:119-123`: "A flows.run
run produces NO agent turn in the host session"), and its spawned `--mode rpc`
session is **only terminated after finalize**
(`packages/automation-plugin/src/server/engine.ts:640-647`,
`abortSpawnedRun({ graceful: true })`).

So when that one frame is lost, **nothing else ever names the run**:

- `reapUndeliveredRuns` cannot help — it skips delivered runs by design
  (`engine.ts:371` `if (ctx.delivered) continue;`), and the spec says so
  explicitly ("a delivered run still executing its work SHALL remain governed by
  the max-age backstop alone", `openspec/specs/automation-run-lifecycle/spec.md`
  → "An undelivered run is reaped on a short bound").
- `onSessionEnded` / `onSessionDeath` cannot fire — the session is alive and idle
  precisely because we never finalized.
- The only remaining terminal is `maxRunAgeMs`, **default 30 minutes**
  (`packages/automation-plugin/src/server/index.ts:189`).

For those 30 minutes the run holds its `concurrency: skip` slot (so every
subsequent scheduled fire is skipped) and `GET /api/plugins/automation/runs`
keeps reporting it `status: "running"`.

**The frame is losable, in this repo, with no retry and no fallback.**
`forwardBusEvent` drops every non-subagent frame unless the bridge is both ready
and current — `packages/extension/src/flow-event-wiring.ts:82-84`
(`else if (deps.isSessionReady() && deps.isActive())`) — and swallows any
forwarding error in a bare `catch {}` (`:86-88`). A superseded bridge instance
(`isActive()` false) silently drops `flow:complete` forever.

### What was measured, and what it ruled out

A live scheduled `invoicebot-intake` fire (action `flows.run`, `concurrency:
skip`) was driven against an **empty** drop folder and polled every 10 s:

```
12:30:02  [... ,["2026-08-12-123000-invoicebot-intake-00002","running",null]]
12:30:12  [... ,["2026-08-12-123000-invoicebot-intake-00002","done",3557]]
```

The empty-folder ("idle terminal") path **does** emit its completion and settles
in ~3.5 s. So the gap is not "one terminal never completes" — it is that the
lifecycle has **no bound at all** when the single completion frame is lost,
which is the difference between a 3.5 s settle and a 30-minute wedge.

## What Changes

- **A delivered event-dispatched run gets a stall bound.** A run that is
  delivered AND declared a completion event AND has observed no session activity
  for `stalledRunTimeoutMs` (new, default **120 s**; `<= 0` disables) SHALL be
  finalized `error`, have its concurrency slot freed, and have its spawned
  session terminated — instead of waiting out `maxRunAgeMs`.
- **Silence is the signal, not elapsed time.** The engine records
  `lastActivityAt` per run (set at delivery, refreshed by a new
  `noteRunActivity(sessionId)` called for every observed frame of a tracked run
  session). A genuinely live run keeps forwarding flow events and is never
  reaped; only a run whose event stream is dead is.
- **Prompt-dispatch runs are untouched.** They have no declared completion, may
  legitimately think for a long time, and keep finalizing on `agent_end` under
  the max-age backstop alone. The existing "A delivered long-running run is not
  reaped early" guarantee is preserved verbatim.
- **The sweep is the existing one.** `reapStaleRuns` gains the new pass; cadence
  stays `REAP_INTERVAL_MS = 15_000`.

- **NOT in scope, and why:**
  - *Making `forwardBusEvent` retry or buffer non-subagent frames.* That is a
    transport-reliability change with its own ordering and back-pressure
    questions. This change makes the run lifecycle **transport-independent**,
    which is the property that was missing; a delivery fix stays falsifiable on
    its own.
  - *Lowering `maxRunAgeMs`.* It is the correct last-resort backstop for
    prompt runs; the defect is the absence of a nearer bound for event runs.
  - *Any change to what a flow emits at any terminal.* Measured above and found
    healthy — changing it would be fixing a refuted hypothesis.

## Discipline Skills

- `observability-instrumentation` — the new terminal path emits a named
  `[finalize] path=stalled-reap` line, matching the existing
  `path=completion-event` / `path=agent_end` / `path=undelivered-reap` taxonomy,
  so a systematic stall is distinguishable from a max-age timeout in
  `server.log`.
- `doubt-driven-review` — the bound finalizes a run the engine cannot prove is
  dead. The stated tradeoff: a live run silent for 120 s is killed. This is
  accepted because an event run's ONLY liveness evidence is its forwarded event
  stream, and the alternative (a 30-minute held slot) starves the schedule.
