# Proposal: fix-backfill-elides-live-tools

## Why

After a server restart or a browser reload, a long-running tool call shows "result not loaded" in the chat. Subagents (`Agent`) are hit hardest. The composer dock meanwhile correctly lists the same calls as running. The tail-only replay window (`add-tail-only-replay-window`) puts any start older than the tail into the lazy backfill. The backfill then stamps every still-`running` row `elided` (`fix-lazy-history-backfill-ux` D5). That stamp assumes an unfinished start's end is already in content the client holds. The assumption is false for a call that has not ended yet.

The row also cannot recover:
- A live `tool_execution_update` never clears `elided`.
- The splice discards the segment's `toolCalls` entry, so a later `session_ended` heal is rejected and the card stays "not loaded" forever.

A spike (branch `spike/backfill-elides-live-tools`, commit `4dd743584`) reproduced all three defects and fixed them in about 20 lines.

## What Changes

- **Server, additive protocol field:** `history_backfill_result` gains optional `openToolCallIds: string[]`. It lists the served top-level starts that are still open: no stored end, and no later `agent_start`, `agent_end` or assistant inference. The server computes it in the same synchronous step that sends the result, so no later end can make it stale. Omitted for relocated sessions and refusals.
- **Client splice:** a row whose id is in `openToolCallIds` stays `running` instead of being stamped `elided`. The splice also seeds a complete top-level `toolCalls` entry (`startedAt`, current inference counter). The real end, the `session_ended` heal, the stale reconcile (200/410) and the superseded heal (on post-splice inferences) can then all close it. This is an explicit exception to the splice's touch-only-`messages[]` rule.
- **Client reducer, backstop:** a top-level `tool_execution_update` for an `elided` row revives it to `running` and re-seats the missing `toolCalls` entry. This covers older servers that omit the field. The exception is a subagent the client already records as terminal: its late tick leaves the row untouched.
- Tools that really finished elsewhere keep today's behaviour: their start in a backfill segment still resolves to `elided`.
- The spike's reproduction test is promoted into the regular suite.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `on-demand-session-replay`: "The client reducer tolerates orphaned events at a window edge". An unfinished start in a backfill segment resolves to `elided` only when the server does not report the call open. A live tick revives an elided row.
- `event-reducer`: "Tool call state machine". The backfill elision exempts server-reported open calls. A top-level `tool_execution_update` revives an `elided` call to `running`.
- `session-history-backfill`:
  - ADDED requirement "A backfill response reports which served tool calls are still open" (serve-time, backfill-specific open rule).
  - MODIFIED "The client splices backfilled events into the gap": tool-call tracking gains reported-open entries.

## Impact

- `packages/shared/src/browser-protocol.ts`: optional `HistoryBackfillResultMessage.openToolCallIds`. Additive; older clients ignore it.
- `packages/server/src/session/open-tool-calls.ts`: new pure `findBackfillOpenToolCalls`. `findOpenToolCalls` is unchanged.
- `packages/server/src/browser-handlers/subscription-handler.ts` (`handleHistoryBackfill`): calls it over the served starts.
- `packages/client/src/lib/chat/event-reducer.ts`:
  - `finalizeBackfillSegment` takes the open set.
  - New revive-on-tick in `tool_execution_update`.
- `packages/client/src/hooks/useMessageHandler.ts` (`history_backfill_result` splice): passes the open set and seeds `toolCalls`.
- `packages/subagents-plugin/src/client/toolRowFinalizer.ts`: `keepTerminalRow` also restores the prior `toolStatus` and map entry.
- No change to rendering components. `AgentToolRenderer` / `ToolCallStep` already render `running` correctly.

## Discipline Skills

- `systematic-debugging`: the root cause is evidence-backed. The spike reproduced the defect before any fix.
- `doubt-driven-review`: the protocol field is a public wire contract (additive, yet hard to retract).
- `review-code`: before commit.
- Not triggered:
  - `security-hardening`: no auth, secrets or untrusted-input surface. The field holds server-derived ids sent to an already-subscribed socket.
  - `performance-optimization`: one bounded backwards walk per backfill request.
  - `observability-instrumentation`: no new endpoint or job.
