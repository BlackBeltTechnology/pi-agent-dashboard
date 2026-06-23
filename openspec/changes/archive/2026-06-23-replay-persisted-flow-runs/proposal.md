## Why

pi-flows now persists every flow-run lifecycle event into the parent session JSONL via `pi.appendEntry("flow-event", …)` (change: `persist-flow-runs`). That persistence is **inert** on the dashboard side: `replayEntriesAsEvents` skips `type:"custom"` entries, so after `/resume`, browser refresh, or dashboard server restart the flow card vanishes. The companion dashboard work — the replay/reducer contract — is the dashboard team's to own per the cross-repo delegation brief.

## What Changes

- Replay path re-forwards persisted flow-run events: `replayEntriesAsEvents` gains a branch for `entry.type === "custom" && entry.customType === "flow-event"`, emitting one `event_forward{eventType, data}` per record, ordered by `seq`. The existing idempotent `reduceFlowEvent` rebuilds the identical per-agent timeline — no client component change.
- Bridge live-path maps the new step-level error event: `FLOW_EVENT_MAP` gains `"flow:agent-error": "flow_agent_error"` so live runs forward it too (not only replay).
- Flow reducer gains a `flow_agent_error` case appending `{ kind: "error", text }` to the agent's `detailHistory` (the `error` variant of `FlowDetailEntry` already exists; only the producer case is missing).
- Client replay delivers events to the plugin store: the `event_replay` handler in `useMessageHandler.ts` mirrors the replayed batch into the plugin-runtime per-session event store (`publishSessionEvent`/new plural `publishSessionEvents`), matching the live `event` path. Without this, `replayEntriesAsEvents` produces the events server-side but the flow card never sees them — the card reads `useSessionEvents`, which only the live path feeds, so it stays null on cold load and the slot never reattaches.

## Capabilities

### New Capabilities
<!-- none — this change extends three existing mechanisms, it does not introduce a new subsystem -->

### Modified Capabilities
- `on-demand-session-replay`: replay SHALL synthesize `event_forward` messages from persisted `flow-event` custom entries (ordered by `seq`), in addition to the existing `message` and `model_change` entries.
- `flow-event-bridge`: the bridge `flow:* → eventType` map SHALL include `flow:agent-error → flow_agent_error`.
- `flows-plugin`: the flow reducer SHALL handle `flow_agent_error` by appending an `{ kind: "error", text }` entry to the targeted agent's `detailHistory`.
- `on-demand-session-replay`: the dashboard client SHALL deliver replayed events into the plugin-runtime per-session event store so plugin slots reading `useSessionEvents` rehydrate on cold load, reusing the shell's `shouldReset` to avoid duplicating events on re-replay.

## Impact

- `packages/shared/src/state-replay.ts` — new replay branch (load-bearing). Duck-types the record as `{ seq, eventType, data, flowRunId }`; no import from pi-flows (repos stay independent).
- `packages/extension/src/flow-event-wiring.ts` — one new `FLOW_EVENT_MAP` entry.
- `packages/flows-plugin/src/flow-reducer.ts` — one new `switch` case.
- `packages/client/src/hooks/useMessageHandler.ts` — `event_replay` case mirrors the batch into the plugin store (reuses existing `shouldReset`).
- `packages/dashboard-plugin-runtime/src/session-events-store.ts` — new `publishSessionEvents` (plural) helper: one array spread + one notify (keeps cold-load delivery O(N), not O(N²) per-append).
- No protocol change, no new dependency, no client component change. Lands independently of pi-flows (harmless without persisted entries; persisted entries are harmless without this).
- Reload survival is **best-effort by design**: flow events are buffered in the parent session until its first assistant message flushes them, so a session killed mid-flow before that flush loses the unwritten events. Corruption-safe (single synchronous writer; corruption-tolerant loader).
