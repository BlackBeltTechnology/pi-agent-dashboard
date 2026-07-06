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

### D1 — Finalize on `flow_complete`, gated by "no seeded prompt"
In the `runText.has(sessionId)` branch, before the `agent_end` case, add:
`event.eventType === "flow_complete" && !runPrompt.has(sessionId)`. The
`runPrompt` absence is what distinguishes an event-dispatch run (never seeded a
prompt) from a prompt-dispatch run — a prompt run that happens to run a flow
still finalizes on its own `agent_end`, never on `flow_complete`. On match:
clear `runText`, call `engine.onSessionEnded(sessionId, result)`.

Chosen over: (a) synthesizing `agent_end` in the bridge (touches the forwarder
for all consumers); (b) finalizing on `flow_complete` unconditionally (would
double-finalize prompt runs that drive flows). Idempotency is preserved by
zombie-runs' `removePending` — a later real `agent_end` is a no-op.

### D2 — Result line from the `FlowResult` payload
Event runs have no assistant text. Derive the run result from the
`flow_complete` data: `flow <flowName> <status>: <lastResult.result.summary>`.
Extracted into an exported `flowCompleteSummaryLine(data)` so it is unit-testable
without booting the plugin (mirrors the existing `extractAssistantText` export +
`result-capture.test.ts` pattern). If any assistant text *was* buffered
(defensive), prefer it.

### D3 — `poppler-utils` in the base image
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

1. Add the `flow_complete` finalize branch + `flowCompleteSummaryLine` export.
2. Add `poppler-utils` to `docker/Dockerfile`; update `docker/AGENTS.md`.
3. Tests: event-dispatch run finalizes on `flow_complete` with summary; prompt
   run ignores `flow_complete`.

## Open Questions

None.
