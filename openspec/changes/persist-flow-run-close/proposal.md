## Why

Dismissing a finished flow run (summary **Dismiss**, or **Close** on an attached not-started panel that sits over a finished run) is sent only as a live `flow_summary_dismissed` event. Nothing is persisted, so every replay (reload, evicted session, server restart) rebuilds the run from the persisted `flow-event` entries and the dismissed run comes back.

## What Changes

- Dismiss carries the run's `runId` (pi-flows already stamps `runId` on every run event).
- The flows plugin bridge persists each dismissal as its own session entry `flow-run-close` (`pi.appendEntry`) and declares that type in `replayEntryTypes`, so replay re-emits `flow_summary_dismissed { runId }`.
- The flows reducer collects closed `runId`s and removes exactly those runs, independent of event order. A dismiss without `runId` keeps today's live-only clear-all.
- **Close** on an attached not-started panel also dismisses the finished run beneath it, so the slot ends up empty and stays empty after replay.

Plugin-only: all edits under `packages/flows-plugin/`. No dashboard core change, no pi-flows change.

## Non-goals

- Ended / disconnected sessions (no bridge to write the entry): behaviour unchanged.
- Persisting per-device UI state (collapse, attachments) — already localStorage.
- Changing pi-flows' `flow-event` records or the TUI summary.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `flow-summary-view`: dismissal survives replay.
- `flow-pre-run-attach`: Close over a finished run dismisses it.
- `flows-plugin`: `flow.dismiss-summary` carries `runId`.
- `plugin-entry-replay`: flows plugin also declares `flow-run-close`.

## Impact

- `packages/flows-plugin/package.json` (`replayEntryTypes`)
- `packages/flows-plugin/src/bridge/flow-event-forward.ts`, `bridge/index.ts` (persist on dismiss)
- `packages/flows-plugin/src/server/flow-control.ts` (runId payload)
- `packages/flows-plugin/src/flow-reducer.ts`, `client/FlowsSessionStateContext.tsx` (closed-run set, `runId` on state)
- `packages/flows-plugin/src/client/FlowDashboard.tsx`, `FlowSummary.tsx` (send `runId`; Close dismisses the run beneath)

## Discipline Skills

- `systematic-debugging` — root cause confirmed (live-only dismiss event, no persisted record); fix is test-first against replay.
- `review-code` — before commit.
- No auth/untrusted-input beyond bounding the `runId` string; no latency budget, no irreversible step.
