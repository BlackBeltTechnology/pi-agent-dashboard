## Context

See proposal.md (Why). Current code:

- Producer `activityFromEvent` maps `tool_execution_end` to `null`, which clears activity (`../pi-dashboard-subagents/extensions/agent.ts`, `activityFromEvent`). `thinking_start` maps to "thinking" and `text_start` to "writing".
- The producer timeline only records finished blocks (`../pi-dashboard-subagents/extensions/events.ts:121-125`, `text_end` / `thinking_end`). Deltas are ignored.
- The bridge strips `details.entries` from `queued`/`running` frames. It is an allowlist strip and leaves other keys alone (`packages/extension/src/subagent-frame-strip.ts`).
- The client reducer copies the optional `activity` (`packages/client/src/lib/chat/event-reducer.ts:541`).
- The collapsed card renders the activity row conditionally, as `{details.activity && …}` (`packages/client/src/components/tool-renderers/AgentToolRenderer.tsx:397`). This is the layout shift.
- The expanded view already uses a fixed `h-[60vh]` (`packages/client-utils/src/minimal-chat/MinimalChatView.tsx:337-346`). Thinking entries render through the shell `thinkingBlock` primitive (`MinimalChatView.tsx:200-210`).

## Goals / Non-Goals

**Goals:** live reasoning/text preview, no card height jump, no tick-size regression.
**Non-Goals:** streaming full blocks; per-token rendering; changing resync cadence; thinking-level selection (shipped in subagents 0.2.6).

## Decisions

1. **A bounded `liveTail` scalar instead of streaming entries.**
   Alternatives considered: put intermediate entries back on ticks, which `subagent-details-payload` rejects; or a new delta channel, which needs new transport and replay semantics. The tail is O(1), fits the 250 ms throttle, and needs no strip change.
2. **Tail length 280 chars.** That's enough for 2 to 3 lines of preview. Its effect on tick size is unverified: the serialized-byte bound is measured by a test. It's a constant in the producer.
3. **Activity holds the last state.** On `tool_execution_end`, keep the previous value instead of clearing it. This is a producer fix. The client additionally reserves the row, so old producers also stop shifting.
4. **Fixed rows on the client.** The activity row is `h-4 truncate` and the preview row is `h-8 line-clamp-2`, both always mounted. They're hidden for non-running states, which removes the jump between running and completed only partly. The terminal swap (preview rows going away, result block appearing) is accepted as a single transition.
5. **In-progress entry in `MinimalChatView`.** Add an optional `liveEntry` prop that renders after `entries` with an "in progress" affordance. `SubagentDetailView` maps `liveTail` onto it.

6. **The key is always present and cleared with a sentinel.** Clearing uses `{kind:"none",text:""}` rather than omitting the key. The client reducer merges patches over existing state and ignores absent keys (`packages/client/src/lib/chat/event-reducer.ts:520-553`, `2430-2446`), so an omitted key would leave a stale tail. The event store only lets a later update subsume an earlier one when every detail key survives with the same type (`packages/server/src/persistence/memory-event-store.ts:463-517`), so omitting the key would also retain one extra update per block. The sentinel avoids both, with no change to the reducer's merge rules or the store's subsumption gate.
7. **Empty state.** In `MinimalChatView`, a non-empty `liveEntry` counts as body content, so the empty placeholder (`MinimalChatView.tsx:358-379`, chosen by `SubagentDetailView.tsx:134-175`) only renders when both are absent.

8. **The reducer normalizes and never rejects.** `readSubagentDetails` gains a `liveTail` reader. Any plain-object `liveTail` is accepted. A valid `{kind:"thinking"|"text", text:string}` is kept, with `text` truncated to 280 characters. Anything else, including the sentinel and malformed or future shapes, becomes the cleared tail. The store's subsumption only compares the outer JS type, `"object"` (`memory-event-store.ts:457-496`). Since an object tail always overwrites, raw and compacted folds stay equivalent.
9. **The card reads the tail from the session map first.** The collapsed card reads `toolDetails` (`AgentToolRenderer.tsx:214`), but resync replies arrive as `subagents:started` and only update `SessionState.subagents` (`packages/extension/src/subagent-forward-sites.ts:67`, `event-reducer.ts:2903`). The card therefore shows `session.subagents.get(agentId)?.liveTail ?? toolDetails.liveTail`, so the sentinel from a resync also clears a stale tail on the card.

## Risks / Trade-offs

- [Tail flicker at 250 ms] → the text only grows within a block, and the clamp keeps the height fixed.
- [Producer emits liveTail on some frames but not others, e.g. an early-error path] → a producer test asserts the key is present on every snapshot kind
- [Old dashboard plus new producer] → the extra key is ignored, so nothing breaks.
- [Strip regression drops `liveTail`] → an L1 test pins that the strip keeps it.

## Migration Plan

Ship the producer (subagents 0.2.7) and the dashboard independently. Either order works. Rollback means reverting either side.
