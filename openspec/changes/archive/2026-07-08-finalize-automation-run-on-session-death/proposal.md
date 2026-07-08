# Finalize automation runs on session death

## Why

A scheduled `flows.run` automation whose flow is **code-only** (no `agent` steps)
can wedge its own schedule permanently. Proven from run logs in a live
`invoice-bot-test` project: the `invoicebot:pull` automation
(`concurrency: skip`, `*/5`) has been dead since a single run at 08:10 — every
subsequent fire is dropped — while its sibling `invoicebot:process` (which has
`agent` steps) has completed 100+ runs with zero wedges.

Root cause is a **connection-teardown race**, not the earlier
"completion-before-registration" theory (delivery is logged *after*
registration). A code-only headless run can exit and tear down its bridge
WebSocket in the same instant its terminal `flow:complete`/`flow_complete` event
is forwarded. When teardown wins the race:

- the forwarded terminal event never reaches the engine, so `onSessionEnded`
  (the **only** path wired to finalization) never fires;
- the gateway *does* observe the death (`connection closed` + `heartbeat timeout
  but session still active, grace period`) but that path is designed for a human
  session that may reconnect, so it does **nothing** to the automation run;
- the run record stays `status: "running"` forever, and the runner's in-memory
  active-run lock is never released;
- with `concurrency: skip`, every later fire is dropped against that stuck lock.

The engine finalizes on forwarded terminal events **only**. It has no finalize
path for a one-shot headless run that dies without delivering one — even though
the server already holds the close signal. The result is a silent, permanent
freeze with no error surfaced anywhere.

Log evidence (stuck run `…-invoicebot-pull-00022`, entire session lifecycle):

```
1  gateway: session registered  019f417d…  cwd=…/invoice-bot-test   (registered)
2  automation: delivering action to run …00022 (session 019f417d…)  (flow:run delivered)
3  gateway: connection closed   019f417d…                            (WS torn down)
4  gateway: heartbeat timeout but session still active, grace period (waits forever)
   (no "run …00022 ended" — ever)
```

Split across pull runs: **3 finalized / 7 stuck** — a pure teardown coin-flip.
Intake never wedges because its `agent` steps keep the session alive ~3s and end
with a clean `agent_end` handshake, so the terminal event always wins the race.

## What Changes

- **Finalize on session death (primary).** For a tracked `kind="automation"`
  run whose session ends (connection close / heartbeat-timeout with no
  reconnect) **before** its declared terminal event arrives, the engine SHALL
  finalize the run exactly once from the close signal — instead of leaving it
  `running` under the human-oriented reconnect-grace path. Finalization SHALL
  capture the last-known result if one was buffered, else record the run as
  errored with a "session ended before completion" reason, and SHALL release the
  concurrency slot (`completeRun`). This reuses the existing idempotent
  finalize/terminate path, so a late terminal event or `agent_end` is a no-op.
- **Stale-run reaper (backstop).** A `running` automation run whose age exceeds a
  configurable ceiling SHALL be reaped: transitioned to `error` and its slot
  freed via `completeRun`, guaranteeing no lost terminal event can wedge a
  schedule permanently regardless of transport. Idempotent with all other
  finalize paths.
- **No change to prompt/agent runs.** Prompt-dispatch and `agent_end`-terminated
  runs finalize exactly as today; this only adds terminal triggers, never removes
  the existing ones.

Operator-side mitigation (documented, not a code requirement here): a code-only
`flows.run` automation MAY set `concurrency: queue|parallel` so a single lost
terminal event self-heals on the next fire. This masks the freeze but does not
fix the orphaned record — the reaper does.

## Capabilities

### Modified Capabilities

- **automation-run-lifecycle** — add two terminal-finalize triggers (session
  death, stale-run reaper) alongside the existing declared-completion and
  `agent_end` triggers. The reconnect-grace path is suppressed for headless
  `kind="automation"` runs, which never reconnect.

## Impact

- **Code:** `packages/automation-plugin/src/server/engine.ts` (wire a
  close/death signal to the existing `finishAndRelease`); the gateway/heartbeat
  seam (`bridge-heartbeat-watchdog`) to route a no-reconnect close for
  `kind="automation"` sessions to the engine; `run-store.ts` (reaper sweep on a
  timer / on fire). No change to `runner.ts` policy semantics.
- **Behavior:** headless code-only automations (e.g. `invoicebot:pull`) finalize
  reliably; `concurrency: skip` schedules can no longer be wedged by one lost
  terminal event. Existing prompt/agent runs are unaffected.
- **Data:** the 7 already-orphaned `run.json` records stay `running` until the
  reaper (or a one-time manual sweep) clears them; they do not self-heal.
- **Open question (does not change the fix):** logs alone cannot tell whether a
  stuck pull actually finished `pullAll` before teardown (result lost) or died
  mid-pull. If preserving pull work matters, a pre-teardown event flush is a
  follow-up; the finalize/reaper fix is identical either way.
