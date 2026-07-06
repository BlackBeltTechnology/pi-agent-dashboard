# Tasks — finalize-event-dispatched-automation-runs

## 1. Contribution declares its completion signal (decoupled)
- [x] 1.1 Extend `buildEvent`'s return with optional
      `completion { eventType: string; summarize?: (data) => string }` in BOTH
      structural mirrors: flows `ActionContributionLike`
      (`packages/flows-plugin/src/server/automation-actions.ts`) and automation
      `ActionEvent`/`ActionRegistration`
      (`packages/automation-plugin/src/server/action-registry.ts`).
- [x] 1.2 `flows.run.buildEvent` declares
      `completion: { eventType: "flow_complete", summarize }` where `summarize`
      builds `flow <flowName> <status>: <lastResult.result.summary>` from the
      `FlowResult` payload (whitespace-collapsed). All flows knowledge stays in
      flows-plugin. Update the stale "Runs finalize on agent_end" comment.

## 2. Generic finalization in the engine + onEvent
- [x] 2.1 Thread `completion` through: `RunDispatch{kind:"event"}` gains
      `completion?`; `buildRunDispatch` propagates `ev.completion`;
      `RunContext.emitEvent` gains `completion?`; `startRunFor` carries it.
- [x] 2.2 In `index.ts` `onEvent`, at event-dispatch delivery record the run's
      `completion` keyed by sessionId (`runCompletion` map). In the buffer
      branch, finalize when `event.eventType === completion.eventType`: clear
      buffers, `engine.onSessionEnded(sessionId, buffered || summarize?.(data))`.
      Keep `agent_end` as the fallback for runs with no declared completion.
      No `flow`/`flow_complete` string in the automation-plugin.
- [x] 2.3 Update `packages/automation-plugin/src/server/AGENTS.md` index.ts +
      action-registry rows; note flows contribution declares completion.

## 2. Docker image PDF tools
- [x] 2.1 Add `poppler-utils` to the base-stage apt install in `docker/Dockerfile`
      (alongside `ripgrep`/`fd-find`, before the build-essential purge).
- [x] 2.2 Update the `Dockerfile` row in `docker/AGENTS.md` (tool list).

## 3. Tests
- [x] 3.1 flows-plugin: the `flows.run` contribution declares `completion` and
      its `summarize` builds the expected line from a `FlowResult` payload
      (status + name + summary; missing summary tolerated).
- [x] 3.2 automation-plugin: mirror the generic `onEvent` finalize decision — a
      run with a recorded `completion` finalizes when the declared event is
      observed and not on an unrelated event; a run with no completion still
      finalizes on `agent_end`.
- [x] 3.3 `npm test` green for both affected packages.

## 4. Verify
- [ ] 4.1 Rebuild the docker image; run the invoicebot scheduled self-picking
      intake end-to-end: successive fires each drain one file (run finalizes,
      session ends, `concurrency: skip` no longer starves), and PDF parsing
      succeeds (poppler present).
