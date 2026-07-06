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

- **Finalize event-dispatched runs on `flow_complete`.** In the automation
  plugin's `onEvent` buffer, for a tracked run session with no seeded prompt
  (i.e. an event-dispatch run), treat the forwarded `flow_complete` event as the
  finalize signal: capture the flow's outcome as the run result and call
  `engine.onSessionEnded`, which (per zombie-runs) terminates the now-idle rpc
  session. Prompt-dispatch runs keep the `agent_end` anchor unchanged. A later
  `agent_end` after this finalize is a no-op (finalization is idempotent via
  `removePending`).
- **Result line for event runs.** Event runs have no assistant turn to capture,
  so the run result is derived from the `flow_complete` payload (`FlowResult`:
  `status` + `flowName` + `lastResult.result.summary`).
- **Ship `poppler-utils` in the docker image** so PDF-parsing flows work in the
  container.

Non-goals: changing the concurrency/queue policy, the board UI, the prompt-path
capture, or pi-flows itself. Confined to making event-dispatched runs end.

## Capabilities

### Modified Capabilities
- `automation-run-lifecycle` — add a requirement that an event-dispatched run
  finalizes (and terminates its session) on the forwarded `flow_complete`
  signal, since it produces no `agent_end`.
- `docker-packaging` — the base image installs `poppler-utils`.

## Impact

- **Automation plugin:** `packages/automation-plugin/src/server/index.ts`
  (`onEvent`: finalize on `flow_complete` for prompt-less tracked runs; new
  exported `flowCompleteSummaryLine` helper).
- **Docker:** `docker/Dockerfile` (add `poppler-utils` to the base apt install),
  `docker/AGENTS.md` (per-file row).
- **Tests:** `packages/automation-plugin/src/__tests__/` — a completed
  event-dispatched run finalizes on `flow_complete` and captures the flow
  summary; a prompt run is unaffected by `flow_complete`.
- **Backward compatible:** prompt-dispatch runs unchanged; runs that still emit
  `agent_end` still finalize there (idempotent).
