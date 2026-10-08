## Why

A running subagent card in the chat does not look like the main session. It never shows reasoning or text while they stream: the card only has a one-word `▸ thinking` / `▸ writing` / `▸ running X` line. That line also disappears after every tool call, so the card grows and shrinks by one line on each step (the "height glitch"). The expanded inspector only shows a thinking or text block after it finishes, and only when the resync cadence pulls the timeline. The thinking-level part of this (dropped `:off`, parent level not inherited) already shipped in `pi-dashboard-subagents` 0.2.6, so this change only covers what the user sees.

## What Changes

- **Producer (`../pi-dashboard-subagents`):** add an optional, bounded `liveTail` field to the subagent `details` snapshot. It holds the tail of the block currently streaming (`kind: "thinking" | "text"`, last ≤ 280 chars) and is updated from `thinking_delta`/`text_delta`. Once a producer sends `liveTail`, it sends it on **every** snapshot, including terminal ones. When nothing is streaming, it sends the cleared form `{ kind: "none", text: "" }`. The key is never omitted, so ticks stay full snapshots, the client clears it by overwriting, and the event store's same-key/same-type subsumption keeps working. Ticks keep their existing 250 ms throttle.
- **Producer:** `tool_execution_end` no longer clears `activity` to `null`. Activity always holds the latest state, so the indicator stops flickering between steps.
- **Bridge strip (`packages/extension/src/subagent-frame-strip.ts`):** keeps `liveTail` on non-terminal frames (only `entries` is stripped). The tick size stays O(1).
- **Client reducer:** copies `liveTail` like `activity`. A `kind: "none"` tail means nothing is streaming.
- **`AgentToolRenderer` (collapsed running card):** a fixed-height activity row that is always rendered (with a placeholder when idle), plus a fixed-height, clamped live-preview line showing `liveTail` styled like the main chat's thinking or text. The card height stays constant while the subagent runs.
- **`MinimalChatView` (expanded or popout):** renders a non-empty `liveTail` as a trailing in-progress thinking or text entry after the finished entries. It counts as body content, so the "No detail available yet" empty state is suppressed, so reasoning appears without waiting for a resync.
- **Thinking level on the card (added in apply):** the producer adds `details.thinkingLevel`, the effective level of the child session (`session.thinkingLevel`, falling back to the requested level). The client reads it and shows `thinking <level>` after the model name in the card stats line and the inspector header. The 0.2.6 fix made the level take effect but never surfaced it.
- The dashboard degrades gracefully: producers without `liveTail` render exactly as today, minus the height jump.

## Capabilities

### New Capabilities
- `subagent-live-reasoning`: live preview of a running subagent's streaming thinking or text, and a stable collapsed-card layout.

### Modified Capabilities
- None. `subagent-details-payload` still holds: `entries` stays stripped from intermediate ticks, and `liveTail` is a bounded scalar. `subagent-live-cadence` is unchanged.

## Impact

- `../pi-dashboard-subagents`: `extensions/agent.ts` (`activityFromEvent`, `snapshotDetails`), `extensions/events.ts`, release 0.2.7.
- Dashboard: `packages/extension/src/subagent-frame-strip.ts` (verify only, plus a test), `packages/client/src/lib/chat/event-reducer.ts`, `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx`, `packages/client-utils/src/minimal-chat/MinimalChatView.tsx` and `types.ts`, `packages/subagents-plugin/src/client/SubagentDetailView.tsx` and `types.ts`.
- The wire contract gains an optional `details.liveTail`, which older dashboards ignore.

## Discipline Skills

- `performance-optimization`: `liveTail` must not undo `reduce-subagent-details-payload` (the tick-size bound) or add render churn (it reuses the existing 250 ms tick, with no new channel).
- `review-code`: before commit.
- No security, observability, or irreversible-step triggers apply.
