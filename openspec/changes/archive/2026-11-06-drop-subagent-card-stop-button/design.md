# Design

## Context

- Card button: `packages/subagents-plugin/src/client/AgentToolRenderer.tsx` builds `stopControl` (a `div[data-testid=agent-stop-row]` holding `button[data-testid=agent-stop-button]` plus the pending / unconfirmed / error spans) and renders it in the queued and running branches.
- Row ■: `packages/client/src/components/chat/ToolCallStep.tsx` renders `<ToolStopControl controller={stop} idleLabel={stopLabel}>` while `status === "running"`. A queued subagent's row is `running` at tool level (`claimRowStatus` only accepts `queued` on a running row). `withClaimStop` calls the claim `stop` first while the base controller is idle; `true` consumes the click.
- Claim `stop`: `agentStop` in `packages/subagents-plugin/src/client/subagentStop.ts` returns `false` unless `stoppable === true` with an `agentId` and `sessionId`, else calls `requestSubagentStop` and returns `true`.
- `requestSubagentStop` is idempotent while `pending` and keeps one state per `(sessionId, agentId)` in a module store, so the card sees a stop started from the row.
- Producer 0.6.0 (`pi-dashboard-subagents/extensions/agent.ts`, `snapshotDetails`) sends `stoppable: true` on queued and running snapshots, and `stopWith("queued")` handles a stop during the slot wait.

## Decisions

### D1: The row ■ is the only stop control

The card's `agent-stop-button` is removed. The row already covers every case the card button did: queued and running, standalone and inside a burst group, with the claim label. Alternative (keep the card button, drop the row stop for subagents) was rejected: the row ■ is the same control every other running tool has, and it stays visible when the card is collapsed.

### D2: The card keeps the feedback line

`agent-stop-row` renders only when `useSubagentStopState` has a state (`pending`, `unconfirmed`, `error`). The row ■ is glyph-only and cannot show a reason, so the card is still where "stopping…" and "stop refused: <reason>" appear.

"Re-enable the control" is now satisfied by the row ■: it never disables on a claim-consumed stop (the base controller stays `idle`), and a second click while pending is a no-op in `requestSubagentStop`.

### D3: A claim-handled stop expands the row

With the card button gone, the stop can be clicked on a collapsed row. The feedback lives in the card, which sits in the row body (`ToolCallStep.tsx`, the `expanded && showResultBody` block). The ■ shows no pending state either, because a claim-handled click leaves the base controller `idle`. So `withClaimStop` calls `onConsumed` when the claim returns `true`, and `ToolCallStep` passes `() => setExpanded(true)`. The change is generic: any claim with a `stop` gets it. Alternative (show pending/error on the ■'s title) was rejected: it needs new state in `ToolStopControl`, and a title is not visible feedback.

## Risks

- A test or external consumer selecting `agent-stop-button`: only `AgentToolRenderer.queue-stop.test.tsx` and `tests/e2e/subagent-queue-stop.spec.ts` #F4 do (grep), both updated in this change.
- The row ■ shows only while the tool row is `running`. A card whose `details.status` is still `running` on a `complete` row is possible (a session-end heal or a lost end frame). Accepted: by then the tool call has returned or the session has ended, so the producer has no run left to stop. The removed card button would have POSTed a stop that the producer ignores (`phase: "unknown"` / `"terminal"`).
- With `showResultBody === false` (display preference "hide tool results"), the row body never renders, so expanding the row shows no card feedback. The outcome still reaches the row through `rowStatus` ("removed from queue" / "stopped").
