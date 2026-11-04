# Proposal

## Why

pi-flows 0.10.0 adds fan-out steps (one target run per item), multi-route decisions and a `skipped` result for untaken branches. The dashboard renders all three wrongly:
- fan-out item runs collapse into one card, and the last item's result hides a failed item;
- the `flow:decision` event never reaches the dashboard;
- skipped steps stay `pending` forever.

The fix should land in the flows plugin only, but core still owns flow wiring:
- the bridge's hard-coded `FLOW_EVENT_MAP`, which reserves every `flow_*` type, so the plugin cannot declare them itself;
- the `flow_control` / `flow_management` protocol messages and their gateway, ACP and scope plumbing;
- the flow types in `shared/types.ts`;
- the pi-flows `flow-event` replay in `shared/state-replay.ts`.

The archived `add-plugin-bridge-contributions` change listed "moving `FLOW_EVENT_MAP` out of core" as a follow-up; this change is that follow-up. The flow panel also shows the graph and the full card grid together, which pushes the chat off screen.

## What Changes

- **pi-flows 0.10 support (flows plugin):**
  - a fan-out step renders as one group card with one card per item, plus an ok / failed rollup;
  - a multi-route `flow:decision` shows the chosen routes (with item counts) and the untaken branches;
  - untaken and unchosen steps read `skipped`, not `pending`;
  - the graph shows skipped steps, item counts and chosen routes;
  - the static YAML preview keeps object-form branches (`{ to, means }`, `{ to, for_each }`).
- **Flow events forwarded by the plugin:**
  - the flows plugin bridge declares every `flow:*` run channel (including `flow:decision`) through `dashboard:register-event-forward` keyed per channel (`stepId`, `flowName`, `agentName` as `stream`; keyless channels `live`);
  - core `FLOW_EVENT_MAP` and the `flow_*` entries of `RESERVED_EVENT_TYPES` are removed;
  - `SUBAGENT_EVENT_MAP` stays in core (out of scope).
- **Flow commands through the plugin:**
  - Abort, Auto, Dismiss summary, Run, Delete and Set edit-mode travel as `plugin_action` (`pluginId: "flows"`) to the flows plugin server, which relays a fixed `flow:*` event through `ctx.emitEventToSession`.
  - **BREAKING**: these are removed from core:
    - the `flow_control` / `flow_management` message types and all their routing (gateway, session-action handler, ACP guard, WS scope / tier / road tables, bridge dispatch);
    - `POST /api/session/:id/flow-control`;
    - the MCP core tool `flow_control` and the bus-client verbs.

    The replacement is a plugin route `POST /api/plugins/flows/control` taking the six `plugin_action` actions; both refuse ACP sessions. The `pi-dashboard` skill commands `dashboard-flow-abort` / `dashboard-flow-auto` keep their names and call the plugin route. The CHANGELOG notes the break.
- **Flow types move to the plugin:** `FlowAgentStatus`, `FlowState`, `FlowAgentState`, `FlowAgentCardConfig` and `NodeKind` move from `shared/src/types.ts` into the flows plugin. `SessionState` has no flow field (only comments); the plugin keeps its own per-session slice.
- **Generic replay opt-in:**
  - a plugin manifest declares the persisted custom-entry types it owns (flows: `flow-event`);
  - core replays any declared type seq-ordered as its recorded protocol events, and keeps it out of the generic `custom_entry` / custom-message paths;
  - `state-replay.ts` and `custom-entry-forward.ts` no longer name `flow-event`.
- **Generic commands-changed seam:**
  - new bus channel `dashboard:commands-changed`, which any plugin emits to make the bridge resend `commands_list`;
  - the flows plugin emits it on `flow:rediscover` / `flow:complete`, replacing the core listeners.
- **Boundary gate:** `check:plugin-boundary` also fails new `flow:` / `flow_` / `pi-flows` string literals in core packages, with an allowlist for catalog data (`recommended-extensions.ts`) and comments.
- **Graph-first flow slot:**
  - the expanded flow panel shows the header and the graph;
  - every agent card sits in an **Agent cards** section that is collapsed by default;
  - the section header shows the step count and state pills (done, running, failed, skipped);
  - clicking a graph node opens the section, selects that step and scrolls its card into view;
  - the section's open state is persisted per session (new collapse kind `cards`);
  - the panel itself stays collapsed by default.
- Mockup: mockups/2026-11-04-flows-plugin-update (in this change)

## Capabilities

### New Capabilities
- `plugin-entry-replay`: a plugin declares persisted custom-entry types it owns; core replays them flow-agnostically and keeps them out of the generic custom-entry rendering.

### Modified Capabilities
- `flows-plugin`: reducer handles fan-out items, `flow_decision` and `skipped`; flow types and the disabled-plugin behaviour move into the plugin; commands through `plugin_action` plus a plugin route.
- `flow-event-bridge`: core no longer maps or forwards `flow:*` channels or handles inbound flow commands; the flows plugin bridge declares the channels.
- `bridge-extension`: drop "Bridge listens to flow events on pi.events" (core).
- `bridge-decomposition`: flow event wiring module keeps only the subagent map and generic forwarding.
- `plugin-event-forwarding`: `flow_*` no longer reserved; an `as` type owned by another plugin is rejected (first owner wins); new `dashboard:commands-changed` channel.
- `flow-browser-protocol`: `flow_control` removed in favour of `plugin_action`.
- `flow-controls`: Abort / Auto dispatch through the flows plugin.
- `dashboard-server`: `POST /api/session/:id/flow-control` removed (plugin route instead).
- `custom-entry-rendering`: flow-event special case becomes the generic plugin-owned entry exclusion.
- `on-demand-session-replay`: persisted flow runs replay through the generic plugin-entry replay.
- `flow-card-grid`: graph-first panel with collapsible Agent cards section; node click opens it.
- `flow-panel-collapse-persistence`: adds the persisted `cards` section state.
- `flow-server-state`: remove the stale core-server flow-metadata requirement (the flows plugin server state store owns it).
- `plugin-core-boundary`: the gate also rejects flow string literals in core.
- `dashboard-shell-slots`: the zero-flow-references rule points at the new literal gate; the flow type allowlist goes away.
- `catch-all-event-forwarding`: the core rename mapping no longer lists `flow:*` channels.
- `shared-protocol`: `FlowControl*` message types removed; flow event types are plugin-declared.
- `flow-plugin-e2e`: tests derive flow event types from the flows plugin bridge declaration.
- `flows-running-status-pill`: the pill's Abort dispatches `plugin_action` `flow.abort`.
- `event-reducer-decomposition`: remove the stale core flow-reducer delegation requirement.
- `flow-card-status`: the minimal live graph may show short status words (skipped, item count, chosen routes).
- `flow-trigger`: dashboard abort dispatches `plugin_action` `flow.abort`, not `flow_control`.
- `command-routing`: the kebab-menu flow actions note now names `plugin_action`, not the removed `flow_management` handler.

## Impact

- **Core, flow code removed:**
  - `packages/extension/src/{flow-event-wiring,bridge,custom-entry-forward}.ts`
  - `bridge-handlers/dispatch.ts`
  - `provider-register.ts` (rename `flow:get-available-models` to a `models:` channel)
- **Shared:**
  - `event-forward-declaration.ts`, `state-replay.ts`, `types.ts`
  - `protocol.ts`, `browser-protocol.ts`, `ws-message-tiers.ts`
- **Server:**
  - `pairing/browser-gateway.ts`, `browser-handlers/{session-action-handler,acp-guard}.ts`
  - `session/session-api.ts`
  - `identity/{ws-message-scope,ws-road-classification}.ts`
  - `acp-bridge/server-requests.ts`
- **Client:** `hooks/useSessionActions.ts`
- **Generated and tooling:**
  - `mcp-server-plugin` tools manifest
  - `bus-client` generated verbs
  - `pi-dashboard` skill `dashboard-bus.ts`
  - `scripts/check-plugin-boundary.mjs`
- **Flows plugin:** bridge, server, reducer, types, `FlowDashboard`, `FlowGraph`, `flow-collapse-storage`, `flow-yaml-parse`, automation actions.
- **Durable replay:** the on-demand-session-replay KNOWN BLOCKER (pi flushes custom entries only after the first assistant message) still applies to `flow-event` entries.
- **Producer floor:** pi-flows ≥ 0.10.0 for the new events. Older pi-flows keeps working; the new fields are just absent.
- **Overlap:** the active `subagent-queue-visibility` change reads `SUBAGENT_EVENT_MAP` in `flow-event-wiring.ts`. This change keeps that map and its exports, so only a file-level merge is needed.
- **BREAKING (CHANGELOG):**
  - `flow_control` / `flow_management` WS messages;
  - REST `/api/session/:id/flow-control`;
  - MCP tool `flow_control`;
  - bus-client verbs.

## Discipline Skills

- `security-hardening`: the new plugin route and `plugin_action` cases take untrusted browser input and relay it into a session (operate authority, fixed event names, validated `flowName`).
- `observability-instrumentation`: new forwarding and replay paths need `/api/health` counters and logs (dropped or rejected declarations, replayed plugin entries).
- `doubt-driven-review`: irreversible public-API removal (REST route, MCP tool, WS message types).
- `review-code`: non-trivial change across about 30 files before commit.
- `performance-optimization`: does not apply. Event volume and payloads are unchanged, and `stream` buffering already exists.
