# Tasks — finalize-event-dispatched-automation-runs

## 1. Finalize event-dispatched runs on flow_complete
- [ ] 1.1 In `packages/automation-plugin/src/server/index.ts` `onEvent`, inside
      the `runText.has(sessionId)` branch, add a `flow_complete` finalize path
      gated by `!runPrompt.has(sessionId)`: clear `runText` and call
      `engine.onSessionEnded(sessionId, result)`. Keep the `agent_end` path as
      the `else` for prompt-dispatch runs.
- [ ] 1.2 Add exported `flowCompleteSummaryLine(data)` deriving the run result
      from the `flow_complete` `FlowResult` payload (`flow <flowName> <status>:
      <lastResult.result.summary>`), whitespace-collapsed. Prefer buffered
      assistant text if any was captured (defensive).
- [ ] 1.3 Update `packages/automation-plugin/src/server/AGENTS.md` index.ts row
      with the new finalize path + `flowCompleteSummaryLine` (See change: …).

## 2. Docker image PDF tools
- [ ] 2.1 Add `poppler-utils` to the base-stage apt install in `docker/Dockerfile`
      (alongside `ripgrep`/`fd-find`, before the build-essential purge).
- [ ] 2.2 Update the `Dockerfile` row in `docker/AGENTS.md` (tool list).

## 3. Tests
- [ ] 3.1 `packages/automation-plugin/src/__tests__/` — `flowCompleteSummaryLine`
      builds the expected line from a `FlowResult` payload (status + name +
      summary; missing summary tolerated).
- [ ] 3.2 Mirror the `onEvent` finalize decision in a focused test: an
      event-dispatch run (no `runPrompt`) finalizes on `flow_complete` and
      captures the summary; a prompt run (with `runPrompt`) does not finalize on
      `flow_complete`.
- [ ] 3.3 `npm test` green for the automation-plugin package.

## 4. Verify
- [ ] 4.1 Rebuild the docker image; run the invoicebot scheduled self-picking
      intake end-to-end: successive fires each drain one file (run finalizes,
      session ends, `concurrency: skip` no longer starves), and PDF parsing
      succeeds (poppler present).
