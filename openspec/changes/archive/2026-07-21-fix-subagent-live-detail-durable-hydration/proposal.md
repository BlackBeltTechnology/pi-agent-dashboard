## Why

A running subagent's inspector timeline (`SubagentDetailView`, inline expand + popout + the `/session/:sessionId/subagent/:agentId` route) is sourced **only** from `session.subagents.get(agentId)`. That map is fed **only** by the ephemeral `subagents:*` `event_forward` frames (plus the `tool_execution_end` backfill at completion). That channel is lossy at two hops:

- **Bridge → server** (`bridge.ts` `pi.events.emit` intercept): subagent frames forward live only when `sessionReady && isActive() && connection.isConnected`; otherwise they are buffered and only drained on **re-register**, not proactively.
- **Server → browser** (`browser-gateway.ts`): frames are **dropped** when the browser socket's `bufferedAmount` crosses `MAX_WS_BUFFER` (4 MB) under back-pressure. A single overloaded session recorded **13 800+** such drops in the field repro.

When those frames don't land, `session.subagents.get(agentId)` is empty/absent and the detail body shows **"Subagent not found in this session."** for the entire run. The D2 **resync** repair path cannot fix it, because the resync *reply* is itself an ephemeral `event_forward` with no client retry — under sustained back-pressure it is dropped by the same mechanism.

Meanwhile the card **header** stays live and the timeline **fills at completion**, because both ride the **durable** message channel: the Agent tool's `partialResult` (`tool_execution_update`) and the `tool_execution_end` backfill. Crucially, that same durable `partialResult` `details` object **already carries the full running snapshot** (`entries[]`, `status`, `tokens`, …) on every ~250 ms tick — the reducer just never uses it to hydrate the inspector map.

This is distinct from `subagent-live-detail-reliability` variant A (a hydration-timing gap on the correct v4 key, which resync fixes) and variant B (`resolve-subagent-inspector-by-session-id`, an identity-space collision). This fixes a **channel-loss** gap: the live timeline depends on a lossy channel when a durable copy is already present client-side.

## What Changes

- **Event reducer** (`packages/client/src/lib/chat/event-reducer.ts`, `tool_execution_update` arm): when a structured `partialResult.details` carries `agentId` and the row is the `Agent` tool, hydrate `session.subagents` from that **durable** snapshot — mirroring the existing `tool_execution_end` (`toolName === "Agent"`) backfill, but with running status. Reuses the existing `readSubagentDetails()` mapper and `setSubagentState()` dual-index helper (so v7 `agentSessionId` deep-links resolve live too). A terminal-state guard prevents a late/reordered running partial from regressing an already-`completed`/`failed` state.

No protocol, bridge, producer, or view change. The ephemeral `subagents:*` channel remains a redundant accelerator; the durable channel becomes the reliable floor.

## Capabilities

### Modified Capabilities

- `subagent-live-detail-reliability`: a running subagent's reduced timeline is hydrated from the **durable** `tool_execution_update` (`partialResult.details`) channel — not only from the ephemeral `subagents:*` frames and the completion backfill. So the inspector renders the live timeline (or the correct "No detail available yet." running state) even when every ephemeral frame and every resync reply is dropped under WS back-pressure.

## Impact

- **Event reducer** — `packages/client/src/lib/chat/event-reducer.ts` (`tool_execution_update` structured-`partialResult` arm): +~40 lines mirroring the `tool_execution_end` Agent backfill; reuses `readSubagentDetails()` + `setSubagentState()`; self-selecting on `toolName === "Agent"` + `details.agentId`.
- **Tests** — `packages/client/src/lib/__tests__/event-reducer.test.ts`: live-hydration test (agentId + entries → map populated, dual-indexed by `agentSessionId`) and a no-regression test (late running partial does not un-complete a terminal state).
- **Specs referenced** — `subagent-live-detail-reliability`.

## Non-Goals

- Retaining/replaying subagent `event_forward` frames at the server hop under back-pressure (the true drop site — Fix C). Deferred: sourcing the live timeline from the durable channel already present client-side removes the dependency far more cheaply.
- Client-side resync retry / broadened resync triggers (Fix B). Deferred: unnecessary for the in-app card once the durable channel feeds the map; revisit only for pure deep-links with no local tool stream.
- Any producer, bridge, or protocol change.

## Discipline Skills

- `systematic-debugging` — root-caused the two-channel split (durable header vs ephemeral timeline) with server.log back-pressure evidence before changing code.
- `review-code` — non-trivial reducer change; reviewed the diff and confirmed no blocking findings before commit.
