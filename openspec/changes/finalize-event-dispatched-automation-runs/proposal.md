# Proposal: finalize-event-dispatched-automation-runs

## Why

Event-dispatched automation runs (`action.kind: flows.run`, which emits a
`flow:run` event into the spawned session instead of seeding a prompt) never
finalize. The archived `fix-automation-stop-zombie-runs` change made a completed
run terminate its spawned session, but it anchored finalization on the
`agent_end` event. A flow started by `flow:run` is consumed **headlessly** by
pi-flows — it runs no agent turn in the host session, so `agent_end` never
fires. The run therefore stays `running` forever:

- its `--mode rpc` session is never terminated (leaked process, the exact defect
  zombie-runs closed for the prompt path — reopened for the event path);
- with `concurrency: skip` (the invoicebot intake default), **every subsequent
  scheduled fire is dropped** because the runner still sees an active run, so a
  drop-folder never drains beyond the first file.

This was found running the invoicebot folder-intake end-to-end in the docker
harness: the scheduled self-picking `invoicebot:process` automation fired once,
the flow completed and wrote its result, but the run sat `running` and blocked
all later fires. pi-flows ≥ 0.3.2 already signals completion via `flow:complete`
(forwarded by the dashboard extension as the `flow_complete` protocol event), so
the signal exists — the automation plugin just does not act on it.

A second, smaller gap surfaced in the same run: the docker image lacks
`poppler-utils`, so any flow that shells out to `pdftotext`/`pdftoppm` (document
parsing — invoicebot and any PDF pipeline) fails its parse node and holds every
item for inspection. The image should ship the tool.

## What Changes

- **The action contribution declares its own completion signal (decoupled).**
  Extend the `buildEvent` return with an optional `completion { eventType,
  summarize? }`. The automation plugin stays generic — it finalizes an
  event-dispatched run when it observes the run's *declared* completion event,
  and derives the result via the *declared* summarizer. No flows-specific event
  name lives in the automation plugin (preserves `decouple-automation-action-registry`).
- **`flows.run` declares `completion: { eventType: "flow_complete", summarize }`.**
  The `flow_complete` name and `FlowResult` shape stay entirely in flows-plugin.
- **Generic finalize in the engine/onEvent.** Thread `completion` through the
  event-dispatch plumbing (`RunDispatch` → `RunContext.emitEvent`); finalize on
  the declared event via `engine.onSessionEnded` (which, per zombie-runs,
  terminates the idle rpc session). Prompt-dispatch runs (no declared
  completion) keep the `agent_end` anchor. Idempotent via `removePending`.
- **Ship `poppler-utils` in the docker image** so PDF-parsing flows work in the
  container.

Non-goals: changing the concurrency/queue policy, the board UI, the prompt-path
capture, or pi-flows itself. Confined to giving event-dispatched runs a
contribution-declared end.

## Capabilities

### Modified Capabilities
- `automation-run-lifecycle` — add a requirement that an event-dispatched run
  finalizes (and terminates its session) on the forwarded `flow_complete`
  signal, since it produces no `agent_end`.
- `docker-packaging` — the base image installs `poppler-utils`.

## Impact

- **Flows plugin:** `packages/flows-plugin/src/server/automation-actions.ts`
  (`ActionContributionLike.buildEvent` return gains `completion`; `flows.run`
  declares it with the `FlowResult` summarizer).
- **Automation plugin:** `packages/automation-plugin/src/server/action-registry.ts`
  (`ActionEvent`/`ActionRegistration` mirror the `completion` field),
  `engine.ts` (`RunDispatch`/`RunContext` carry `completion`; `buildRunDispatch`
  propagates it), `index.ts` (`onEvent`: record `completion` at delivery,
  finalize generically on the declared event).
- **Docker:** `docker/Dockerfile` (add `poppler-utils` to the base apt install),
  `docker/AGENTS.md` (per-file row).
- **Tests:** flows contribution `summarize`; generic `onEvent` finalize on a
  declared completion event vs. an unrelated event; prompt run still finalizes
  on `agent_end`.
- **Backward compatible:** prompt-dispatch runs unchanged; event actions that
  declare no completion still finalize on `agent_end` (idempotent).
