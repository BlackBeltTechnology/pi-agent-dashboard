# Design — finalize-event-dispatched-automation-runs

## Context

Two dispatch shapes reach a spawned automation run session (from
`automation-emit-configured-event` + `decouple-automation-action-registry`):

- **prompt dispatch** — the action seeds prompt text via `sendToSession`; the
  agent runs a turn; the run finalizes on `agent_end` (buffered assistant text →
  `result.md`); zombie-runs then terminates the rpc session.
- **event dispatch** — the action emits a configured event
  (`flows.run` → `flow:run`) via `emitEventToSession`; **no prompt, no agent
  turn**. pi-flows consumes `flow:run` headlessly and runs the flow. The host
  session emits no `agent_end`.

`onEvent` in `index.ts` only finalizes on `agent_end`, so event-dispatch runs
never finalize → session leak + `concurrency: skip` starvation.

pi-flows ≥ 0.3.2 emits `flow:complete` at flow end (carrying the `FlowResult`);
the dashboard extension's `FLOW_EVENT_MAP` forwards it to the run session as the
`flow_complete` protocol event. So the completion signal already arrives at
`onEvent` — it is simply ignored.

## Goals / Non-Goals

**Goals:** event-dispatched runs finalize exactly once, terminate their session,
and free the concurrency slot; the run result reflects the flow outcome; PDF
flows run in the docker image.

**Non-Goals:** concurrency/queue policy, board UI, prompt-path capture,
pi-flows changes, retrofitting a synthetic `agent_end`.

## Decisions

### D1 — The completion signal is DECLARED BY THE ACTION CONTRIBUTION, not hardcoded
The automation-plugin must not know any flows-specific event. The action that
declares **how a run starts** (`buildEvent` → `flow:run`) also declares **how it
ends**. Extend the contribution's `buildEvent` return with an optional
`completion`:

```ts
buildEvent?: (...) => {
  eventType: string;                  // start event
  data?: Record<string, unknown>;
  completion?: {                      // how a run of THIS action finishes
    eventType: string;                // forwarded event that means "done"
    summarize?: (data) => string;     // derive the run result from its payload
  };
} | null;
```

The automation engine finalizes an event-dispatched run **generically**: when it
observes the run's *declared* `completion.eventType`, it finalizes once and
terminates the session. No `flow`/`flow_complete`/`FlowResult` string appears in
the automation-plugin.

`flows.run` declares `completion: { eventType: "flow_complete", summarize }` — the
`flow_complete` protocol name (the extension's `FLOW_EVENT_MAP` forwards
`flow:complete` → `flow_complete`) and the `FlowResult` shape stay entirely in
flows-plugin.

Chosen over: (a) hardcoding `flow_complete` in automation `onEvent` (reintroduces
the coupling `decouple-automation-action-registry` removed); (b) synthesizing
`agent_end` in the bridge (touches the forwarder for all consumers).

### D2 — Generic finalization keyed by the delivered run's completion
At event-dispatch delivery the engine records the run's `completion` (from
`RunContext.emitEvent.completion`) keyed by sessionId. In the `onEvent` buffer,
finalize when `event.eventType === completion.eventType`: clear buffers and call
`engine.onSessionEnded(sessionId, result)`. This is what distinguishes an
event-dispatch run (has a recorded completion) from a prompt-dispatch run (no
completion → still finalizes on `agent_end`). Result text = buffered assistant
text if any (defensive), else `completion.summarize?.(data)`. Idempotency is
preserved by zombie-runs' `removePending` — a later real `agent_end` is a no-op.

Thread `completion` through the existing event-dispatch plumbing:
`RunDispatch{kind:"event"}` → `RunContext.emitEvent.completion` (one added
optional field, no new delivery path). Both structural contribution mirrors
(flows `ActionContributionLike`, automation `ActionEvent`/`ActionRegistration`)
gain the `completion` field so it survives the publish/collect bus.

### D3 — Summarizer + generic finalize are unit-testable
The flows `summarize` and the generic finalize decision are both exercisable
without booting the plugin, mirroring the `extractAssistantText` export +
`result-capture.test.ts` pattern: assert `summarize(FlowResult)` builds the line,
and mirror the `onEvent` completion-match decision in a focused test.

### D4 — `poppler-utils` in the base image
Add to the base-stage apt install line (alongside `ripgrep`/`fd-find`), not the
app stage, so both `pdftotext` and `pdftoppm` are present for any flow. It is a
small runtime dependency of document-parsing flows, not a build tool, so it must
survive the build-essential purge (base stage does).

## Risks / Trade-offs

- **A prompt-dispatch run that also emits `flow_complete`.** Guarded by
  `!runPrompt.has(sessionId)` — such a run has a seeded prompt, so it is skipped
  here and finalizes on `agent_end` as today.
- **`flow_complete` arrives but the session lingers.** `onSessionEnded` already
  owns termination (zombie-runs `abortAutomationRun`, graceful); no new path.
- **No `flow_complete` ever (flow hard-crashes before emit).** Out of scope —
  the manual stop path (zombie-runs) still terminates such a run; unchanged.

## Migration Plan

1. Extend both contribution mirrors' `buildEvent` return with optional
   `completion { eventType, summarize? }` (flows `ActionContributionLike`;
   automation `ActionEvent`/`ActionRegistration`).
2. `flows.run.buildEvent` declares `completion` (`flow_complete` + `FlowResult`
   summarizer) — flows-owned.
3. Thread `completion` through `RunDispatch{event}` → `RunContext.emitEvent` →
   record at delivery; finalize generically in `onEvent` on the declared event.
4. Add `poppler-utils` to `docker/Dockerfile`; update `docker/AGENTS.md`.
5. Tests: flows `summarize` builds the line; generic finalize triggers on a
   declared completion event and not on an unrelated event; prompt run still
   finalizes on `agent_end`.

## Open Questions

None.
