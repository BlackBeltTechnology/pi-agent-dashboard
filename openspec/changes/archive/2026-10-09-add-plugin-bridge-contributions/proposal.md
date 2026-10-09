## Why

A running subagent's inspector shows no tool calls and no finished reasoning until the run ends, and its live reasoning is a 280-char sliding window that never grows. Root cause: `pi-dashboard-subagents` ≥ 0.3.0 moved the live timeline to per-step `subagents:entry` (0.3.0) and append-only `subagents:delta` (0.4.0) channels, but the dashboard core bridge forwards only a hard-coded channel list (`packages/extension/src/flow-event-wiring.ts` `FLOW_EVENT_MAP` + `SUBAGENT_EVENT_MAP`), so both are dropped; progress ticks and resync replies no longer carry `entries`. Plugins have no way to declare the bus channels they consume, so every producer change needs a core edit. Two adjacent defects ride the same surface: a supersede-healed Agent card shows the heal sentinel instead of the subagent's result, and plugin bridges load even when their plugin is disabled.

## What Changes

- **Plugin event-forward registry (core bridge, generic).** A plugin bridge entry declares the bus channels it wants forwarded by emitting `dashboard:register-event-forward` `{ pluginId, channels: { <channel>: { as?, delivery, key? } } }`. The main bridge subscribes each newly declared channel once and forwards through the existing gate. A `dashboard:bridge-ready` handshake lets a plugin that activated before the main bridge re-declare. No plugin channel names in core.
- **Delivery modes per declared channel:** `live` (today's generic rule: forward only while ready), `latest` (keep newest per key until ready — today's subagent snapshot rule), `stream` (keep every message per key in order, bounded, flush on ready — never coalesced).
- **subagents-plugin gains a bridge entry** declaring `subagents:entry` → `subagent_entry` and `subagents:delta` → `subagent_delta`, both `stream` keyed by `agentId`.
- **Live timeline in the inspector.** Server stores `subagent_entry` / `subagent_delta`; client reducer appends entries by `index` (dedupe) into `session.subagents`, assembles the in-progress block from deltas by `blockId`/`offset`, and swaps it for the finished entry carrying the same `blockId`. The inspector renders the growing block like the main chat; the collapsed card keeps its one-line `liveTail` ticker.
- **Remove the head+tail subagent timeline truncation** (`⋯ N steps hidden ⋯`, `reduceSubagentEvent` in `memory-event-store.ts`). With a per-step stream the timeline is rebuilt from small `subagent_entry` events, so oversized terminal frames drop their redundant `entries` instead of being head/tail-cut. **BREAKING (storage display):** the "steps hidden" sentinel is no longer produced.
- **Healed Agent card shows the real result:** when the tool row's result is the supersede-heal sentinel, the card renders `session.subagents.get(agentId).result`.
- **Tool output in the minimal chat view** unwraps a `{ content: [{ type: "text", text }] }` result envelope to its text instead of `JSON.stringify`.
- **Role guidance for the Agent tool, owned by the roles plugin.** roles-plugin gains a bridge entry that, on `before_agent_start`, appends an Agent-tool guideline (prefer `model: "@role"`; lists current roles) seeded from the resolver's `roles:get-all`. Absent when the plugin is disabled or no roles exist. No change to core or to the subagents producer.
- **Plugin bridges honor enablement:** bridges are registered only for enabled plugins and removed on disable, as `dashboard-plugin-loader` already specifies (code currently ignores `enabled`).

## Capabilities

### New Capabilities
- `plugin-event-forwarding`: plugin-declared bus channel forwarding with delivery modes and ready handshake.
- `subagent-live-timeline`: dashboard consumption of `subagent_entry` / `subagent_delta` into a growing live timeline and in-progress block.
- `role-agent-guidance`: roles-plugin bridge appends role guidance to the Agent tool when roles exist.

### Modified Capabilities
- `catch-all-event-forwarding`: the declared channel set is extended at runtime by plugin declarations; subscriptions for a declared channel are established once when declared.
- `in-memory-event-buffer`: per-event ceiling no longer head+tail-reduces subagent timelines; oversized subagent terminal frames elide `entries`.
- `subagent-live-reasoning`: the expanded inspector shows the full in-progress block from the delta stream; `liveTail` remains the card ticker source and the fallback for producers without deltas.
- `minimal-chat-view`: tool output text-envelope unwrapping.

## Impact

- Core bridge: `packages/extension/src/flow-event-wiring.ts`, `bridge.ts`, new stream buffer (generalising `subagent-frame-buffer.ts` semantics).
- Shared: event-forward declaration types in `packages/shared/src`; `plugin-bridge-register.ts` + `server.ts` bridge registration by enablement.
- Server: `packages/server/src/persistence/memory-event-store.ts` (truncator removal, terminal-frame elision, delta retention).
- Client: `event-reducer.ts`, `AgentToolRenderer.tsx`, `packages/client-utils/src/minimal-chat/MinimalChatView.tsx`, `packages/subagents-plugin/src/client/SubagentDetailView.tsx`.
- New bridge entries: `packages/subagents-plugin/src/bridge/index.ts`, `packages/roles-plugin/src/bridge/index.ts` (+ manifest `bridge` fields).
- Producer contract consumed: `pi-dashboard-subagents` 0.4.0 (`SubagentEntryEvent`, `SubagentDeltaEvent`). Older producers keep today's tick/resync path.
- Bridge entries take effect at the next pi session start (pi loads `packages[]` at start).

## Discipline Skills

- `performance-optimization`: stream buffers and stored deltas must stay bounded; per-step events must not regress the tick/storage budgets measured for #831.
- `observability-instrumentation`: counters for declared channels, stream buffer drops, delta gaps (`/api/health`).
- `security-hardening`: plugin-supplied channel declarations are untrusted input (validate names, cap count/size, reject core channel hijack).
- `doubt-driven-review`: removing the timeline truncator is an irreversible storage-shape change.
- `review-code`: before commit.
