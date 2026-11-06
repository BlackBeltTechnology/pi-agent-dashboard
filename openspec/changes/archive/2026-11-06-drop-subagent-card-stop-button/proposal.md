# Proposal

## Why

A queued or running subagent offers two stop controls that do the same thing:
- the chat row's ■ (`ToolStopControl` in `ToolCallStep`), which the `Agent` claim's `stop` (`agentStop`) already routes to the per-subagent stop when `stoppable: true`;
- the card's own "Stop subagent" / "Remove from queue" button (`agent-stop-button` in `AgentToolRenderer`).

Both call `requestSubagentStop(sessionId, agentId)`. The second button adds clutter to every running card in a fan-out and uses a whole line of the card for an action that is already one click away on the row.

## What Changes

- **Remove the card stop button.** `AgentToolRenderer` no longer renders `agent-stop-button`. The row ■ is the single per-subagent stop. Its accessible label stays claim-driven (`agentStopLabel`: "Remove from queue" / "Stop subagent" / "Stop (ends the whole turn)").
- **Keep the feedback on the card.** The card still reads the shared stop store (`useSubagentStopState`) and shows "stopping…", "stop not confirmed" or "stop refused: <reason>" when a stop was requested from the row. With no stop requested, the card shows no stop line at all.
- **A claim-handled row stop expands the row (core).** In `ToolCallStep`, when the claim's `stop` handles the click (returns `true`), the row expands. The card and its feedback are then visible, even if the user had collapsed the row. This applies to any tool, not just subagents.
- **Unchanged:** the stop route, `agentStop`, `agentRowStatus`, `agentStopLabel`, the fallback for producers without `stoppable`, the stopped presentation, the burst group's own stop.
- Mockup: mockups/2026-11-06-subagent-card-live (in this change)

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `subagent-stop-control`: the row is the only stop control; the card shows the stop feedback without a control of its own.

## Discipline Skills

None apply. This is a client-only UI change: no auth, untrusted input, secrets, latency budget, new endpoint, or irreversible step. The stop route and its security gates are untouched. `review-code` runs inline before commit as usual.

## Impact

- `packages/subagents-plugin/src/client/AgentToolRenderer.tsx`: drop the button. Change the gate of `agent-stop-row` from `stoppable && agentId && sessionId && live` to "a stop state exists" (new: no stop requested → no line). Drop the now-unused `requestSubagentStop` / `agentStopLabel` / `mdiStop` imports.
- `packages/client/src/components/chat/ToolCallStep.tsx`: `withClaimStop` gets an `onConsumed` callback that expands the row.
- `packages/subagents-plugin/src/client/__tests__/AgentToolRenderer.queue-stop.test.tsx` (#X1-#X3 trigger the stop through `agentStop`, the row path; new "no card button" case).
- `tests/e2e/subagent-queue-stop.spec.ts` #F4 clicks the row's `tool-stop-button` instead of `agent-stop-button`.
- `packages/client/src/components/__tests__/ToolCallStep.row-status-stop.test.tsx`: a claim-handled stop expands a collapsed row.
- AGENTS.md rows: `packages/subagents-plugin/src/client/AGENTS.md` (`AgentToolRenderer.tsx`), `packages/client/src/components/chat/ToolCallStep.tsx.AGENTS.md`.
