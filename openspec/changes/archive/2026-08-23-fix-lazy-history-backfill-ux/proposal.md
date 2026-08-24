## Why

`lazy-load-session-history` shipped the head/tail replay window plus on-demand backfill, but field testing on issue #521 found the affordance does not behave like history loading in any chat app, and that it manufactures stuck tool cards:

1. **Backfill fills from the wrong end.** `nextBackfillRange` requests `headMaxSeq + 1` upward, so "Load earlier" walks the gap from the *oldest* end. The user asked for earlier history and receives the session's beginning instead of the messages immediately preceding what they are reading. The rationale on record is protocol bookkeeping (only a head-adjacent range lets the server advance `headMaxSeq` and report a shrinking `remainingGapCount`), not user need.
2. **Scroll position jumps after a splice.** The splice anchor preserves *distance to the bottom of content*, which holds the viewport steady only for insertions above the reading position. Combined with a virtualizer whose newly spliced rows carry estimated sizes until measured, the result is an arbitrary landing position.
3. **Windowed replay strands tool cards on the running spinner.** `handleHistoryBackfill` applies no boundary snapping — its upper bound is `from + BACKFILL_MAX_SPAN - 1`, a pure arithmetic clamp — so nearly every splice ends mid-turn, orphaning a `tool_execution_start` whose `tool_execution_end` is still in the gap. The row renders via `msg.toolStatus ?? "running"` (`ChatView.tsx:1232`) and there is **no recovery path at all**: the splice merges rows only (`useMessageHandler.ts:796`), so a backfilled tool call never enters `state.toolCalls`, which is the only thing `useStaleToolReconcile` scans. The reporter observed a stuck spinner on 6 of 10 loads. Where an orphan *does* arrive through the initial windowed replay it is reachable by the reconcile, but only after ≈25–40s, and it then labels a *windowing* decision as a fault: `"result unavailable — recovered by supersede heal"`.

Two adjacent gaps surfaced during validation. `maxReplayEvents` defaults to `0`, so nobody benefits without reading the issue thread. And when a gap turns out to be unservable because retention trimmed it, the divider says so but never explains why — leaving a correct, deliberate outcome looking like a malfunction.

## What Changes

- **Tail-anchored backfill.** The gap becomes symmetric: the client requests the range *immediately below* `tailMinSeq`, and the server retreats `tailMinSeq` on a tail-adjacent range exactly as it advances `headMaxSeq` on a head-adjacent one. `remainingGapCount` is already a store read over both edges, so the loop still terminates. Newly loaded events land directly above the tail — the chat-app behaviour requested in #521.
- **Backfill slices snap to message boundaries.** The `SNAP_LOOKUP` edge-snapping already applied to the initial window is extended to each slice's *gap-facing* edge, defined by request orientation so a legacy head-first client stays correct.
- **An `elided` terminal state for unjoinable tool calls, at the row level.** Because snapping is best-effort by design, the reducer gains the correctness floor: **every** tool call still running once a backfill segment is fully reduced is stamped `elided` on the chat row — no spinner, no error semantics, no wait, no misattribution. All of them, because a dangling start's completion is always in already-delivered content and can never arrive. Row-level, because the splice deliberately does not merge the segment's tool-call map. The same pass finalizes an assistant row the segment left mid-stream, which would otherwise be a permanently "streaming" bubble.
- **Scroll fix by deletion, not addition.** With events now spliced *below* the divider, nothing above the reading position moves, so the correct behaviour is to leave `scrollTop` alone. The distance-to-bottom anchor, its layout effect, and its disarm effect are removed from this path rather than made more elaborate.
- **The unservable gap explains itself.** The divider's existing `unservable` state — already correctly presented as "not an error" — states *why* the events cannot be loaded (retention trimmed them). Memory Limits gains unconditional help text documenting the `maxReplayEvents` / `maxEventsPerSession` interaction.
- **BREAKING (behavioural default):** `memoryLimits.maxReplayEvents` default changes from `0` (unlimited) to a positive window. This touches four separate defaulting sites, not one constant — including `parseMaxReplayEvents`, which currently cannot distinguish an absent field from an explicit `0`. Configs that set the field to a positive value are unaffected; an explicit `0` still means unlimited and remains the rollback lever. The exact value is settled in `design.md`.

## Capabilities

### New Capabilities

None. Every behaviour lands in a capability introduced by `lazy-load-session-history`.

### Modified Capabilities

- `session-history-backfill`: request direction reverses to tail-anchored; the server accepts and accounts for tail-adjacent ranges; slices snap on their gap-facing edge; the scroll-preservation requirement is restated for a below-anchor insertion; the unservable divider explains its cause.
- `on-demand-session-replay`: reducer tolerance at a segment seam is raised from "does not crash" to "resolves to a truthful terminal state" for an orphaned `tool_execution_start`.
- `event-reducer`: the tool-call state machine and the chat row's `toolStatus` union gain the `elided` terminal status and its rendering contract.
- `shared-config`: `memoryLimits.maxReplayEvents` default changes from `0` to a positive window, which requires absent-vs-explicit-zero discrimination in parsing.
- `settings-panel`: the Memory Limits section documents the `maxReplayEvents` / `maxEventsPerSession` interaction and displays the real default.

## Impact

- `packages/server/src/browser-handlers/subscription-handler.ts` — `GapState.tailMinSeq` becomes mutable; `handleHistoryBackfill` credits the abutting edge, snaps the gap-facing edge, and derives `remainingGapCount` from both; the snapping helper is extracted from `computeReplayWindow` for reuse; the `ctx.maxReplayEvents ?? 0` fallback is revisited.
- `packages/client/src/lib/chat/history-gap.ts` — `nextBackfillRange` inverts to walk downward from `tailMinSeq`; `HistoryGapState.tailMinSeq` becomes mutable; the scroll-anchor helpers are removed if this was their only call site.
- `packages/client/src/hooks/useMessageHandler.ts` — splice position moves to `at + 1`; gap bookkeeping follows the new direction; the `elided` stamp is applied to segment rows before merge.
- `packages/client/src/components/chat/ChatView.tsx` — the backfill anchor capture/restore, its layout effect, and its disarm effect are removed, along with the now-dead `historySpliceRev` prop; the grow-pin (`:784`) and the selection-anchor compensator (`:1003-1051`) must be suppressed for the splice commit; the `msg.toolStatus ?? "running"` default is audited.
- `packages/client/src/components/chat/ToolCallStep.tsx` — its `status` prop union must be widened or the build fails.
- `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx` — its `mapStatus` ternary maps any unknown status to `running`, so an elided subagent row would spin.
- `packages/client/src/lib/chat/group-tool-calls.ts` — grouping must not absorb an elided row.
- `packages/client/src/components/chat/ToolBurstGroup.tsx`, `CollapsedToolGroup.tsx` — `?? "complete"` defaults and the burst `doneCount` audited for the widened union.
- `packages/client/src/components/chat/HistoryGapDivider.tsx` — the `unservable` state explains its cause.
- `packages/client/src/lib/chat/event-reducer.ts` — `elided` added to both `ToolCall.status` and `ChatMessage.toolStatus`.
- `packages/client/src/hooks/useStaleToolReconcile.ts` — must not claim an `elided` row; note it never sees spliced rows at all.
- `packages/shared/src/config.ts` — `DEFAULT_MEMORY_LIMITS.maxReplayEvents` **and** `parseMaxReplayEvents` presence detection.
- `packages/client/src/components/settings/SettingsPanel.tsx` — `computeConfigPartial`'s whole-object `memoryLimits` write, which would otherwise persist an explicit `maxReplayEvents` the user never chose whenever any sibling field is edited; the displayed value; plus help text via `packages/client/src/lib/i18n/`.
- Existing coverage to update: `packages/server/src/__tests__/subscription-handler-backfill.test.ts`, `subscription-handler-window.test.ts`, `packages/client/src/hooks/__tests__/useMessageHandler.history-gap.test.tsx`, `packages/shared/src/__tests__/config.test.ts`, `tests/e2e/max-replay-events-setting.spec.ts`.
- No wire-format break: `history_backfill` / `history_backfill_result` field names are unchanged; only which range a well-behaved client asks for, and which edge the server credits.

## Discipline Skills

- `doubt-driven-review` — the `maxReplayEvents` default flip is a behavioural change for every user who never set the field; stress-test it before it stands. (One cycle already run on this proposal and `design.md`; it inverted the scroll decision, the settings-warning decision, and the level at which `elided` is stored.)
- `systematic-debugging` — the stuck-spinner report is a live bug with a reproduction rate (6/10); root-cause it against a real windowed session rather than fixing by inspection alone.
- `review-code` — non-trivial change across server protocol, reducer, and virtualized rendering.
- `performance-optimization` — the scroll path is per-frame; verify the fix by measurement, not by assertion.
