# Design

## Context

See proposal.md (Why). Current state, cited:

- **Event forwarding (core).**
  - `packages/extension/src/flow-event-wiring.ts:10` exports `FLOW_EVENT_MAP` (15 `flow:*` → `flow_*` renames); `:96` exports `SUBAGENT_EVENT_MAP`.
  - `packages/extension/src/bridge.ts:1909` spreads both into `EVENT_BUS_MAP`; `forwardBusEvent` (`flow-event-wiring.ts:69`) forwards non-subagent channels while ready+active, else drops.
  - `flow:decision` is absent from the map, so it never reaches the dashboard.
- **Plugin-declared forwarding** already exists: `dashboard:register-event-forward` → `PluginForwardRegistry` (docs/architecture.md, "Plugin-declared event forwarding").
  - `RESERVED_EVENT_TYPES` (`packages/shared/src/event-forward-declaration.ts:54`, flow entries `:65`) rejects `as: "flow_*"` (`:122`), so the flows plugin cannot declare its own channels today.
  - Precedent: `subagents-plugin/src/bridge/index.ts` declares `subagents:entry` / `subagents:delta` (stream, key `agentId`).
- **Inbound commands (core).**
  - `bridge-handlers/dispatch.ts:246` maps `flow_management` → `flow:run` / `flow:set-edit-mode` / `flow:delete-request`; `dispatch.ts:442` maps `flow_control` → `flow:abort` (+ `flow:architect-abort`) / `flow:toggle-autonomous` / `flow:summary-dismissed`.
  - Routed by `server/src/pairing/browser-gateway.ts:2228,2426`, `browser-handlers/session-action-handler.ts:1220`, `acp-bridge/server-requests.ts:104,112`, `browser-handlers/acp-guard.ts:21-22`, `identity/ws-message-scope.ts:43,93`, `identity/ws-road-classification.ts:87`, `shared/src/ws-message-tiers.ts:58-59`.
  - Typed in `shared/src/protocol.ts:1391,1452` and `browser-protocol.ts:2079,2091`.
  - REST `POST /api/session/:id/flow-control` (`server/src/session/session-api.ts:531`); MCP tool `flow_control` (`packages/mcp-server-plugin/src/server/tools.manifest.ts:54`, `packages/shared/src/mcp/verb-tiers.generated.ts:29`); bus verbs (`packages/bus-client/src/generated/verbs.ts:33-34`); `pi-dashboard` skill commands `dashboard-flow-abort.md` / `dashboard-flow-auto.md`, `scripts/dashboard-api.sh`, `scripts/dashboard-bus.ts:173` and the `claude-plugin` `pi-dashboard-control` skill references call the REST route.
  - Core client `hooks/useSessionActions.ts:203` (`handleFlowAction`).
- **Generic relay** already exists: the flows plugin server handles `plugin_action` (`flows-plugin/src/server/index.ts:144`) and relays `flow.run` through `emitEventToSession` (`:185`) → bridge `plugin_emit_event` (`dispatch.ts:388`, event-agnostic).
- **Replay (core).** `shared/src/state-replay.ts:72` collects `customType === "flow-event"` records `{seq, eventType, data}` and re-emits them seq-sorted (`:301`); `:95` / `:251` and `extension/src/custom-entry-forward.ts:38` exclude `flow-event` from the generic custom-entry paths.
- **Types.** `FlowAgentStatus`, `FlowAgentCardConfig`, `NodeKind`, `FlowAgentState`, `FlowState` live in `shared/src/types.ts:1583-1680`.
- **Reducer.** `flows-plugin/src/flow-reducer.ts`:
  - keys cards by `stepId` (`findAgent`, `:61`), so fan-out items collide and a later start counts as a rerun (`isRerun`);
  - `flow_complete` downgrades only `running` / `pending` on non-success, so skipped steps stay `pending`;
  - unknown `flow_*` types fall to `default` (no-op).
- **Flow panel.** `packages/flows-plugin/src/client/FlowDashboard.tsx`:
  - one collapse toggle (`:153`, kind `dashboard`, default collapsed via `packages/flows-plugin/src/client/flow-collapse-storage.ts:18`);
  - expanded renders `FlowGraph` (`:359`) plus the full card grid (`:397`).
- **Static preview.** `packages/flows-plugin/src/client/flow-yaml-parse.ts:64` keeps only string branch targets. The live graph is fine because pi-flows normalises branches before `flow:flow-started` (pi-flows `flow-parser-yaml.ts` `parseBranches`).
- **Plugin `emits` gate.** The loader lets `emitEventToSession` relay only events listed in the manifest `emits` (`openspec/specs/dashboard-plugin-loader/spec.md`); flows declares `flow:run`, `flow:set-edit-mode`, `dashboard-flows:report-files` today (`packages/flows-plugin/package.json:46`).
- **ACP.** `browser-handlers/acp-guard.ts:21-22` refuses `flow_control` / `flow_management` for ACP sessions; `plugin_action` is not in that set.
- **Stream retention.** A frame whose declared key field is missing is not retained (`packages/extension/src/stream-forward-buffer.ts:95`). pi-flows 0.10 emits `stepId` on step channels, `flowName` on `flow:flow-started` / `flow:complete`, `agentName` on `flow:auto-decision`, and no key on `flow:summary-*` / `flow:autonomous-mode-changed`.
- **Dead core literals.** `packages/client/src/hooks/useDebugToolsVisible.ts:16-17` hides tool names `flow:list-flows` / `flow:rediscover`; pi-flows 0.10 registers no such tools (its tools: `flow_agents`, `flow_results`, `flow_write`, `ask_user`).
- **pi-flows 0.9 / 0.10 facts used here** (checked in the published 0.10.0 package and the installed 0.9.0): neither emits nor listens on `flow:get-available-models` (only `provider-register.ts` uses it); `flow:decision` carries `stepId`; `flow:complete` carries `flowName`; registered tools are `ask_user`, `flow_agents`, `flow_results`, `flow_write`.
- **Plugin bridge lifecycle.** A disabled plugin's bridge entry is deregistered (`shared/src/plugin-bridge-register.ts`, `syncPluginBridges`).

## Goals / Non-Goals

**Goals:**
- Core packages hold no pi-flows-specific behaviour: no `flow:` / `flow_` channel or message names, no flow types, no `flow-event` replay.
- Every capability above reaches core only through generic, plugin-agnostic seams.

**Non-Goals:**
- `SUBAGENT_EVENT_MAP`, the subagent frame buffer and the subagent lifecycle stay core (active `subagent-queue-visibility` depends on them).
- No pi-flows producer change.
- No graph layout redesign (`FlowGraph` / `deriveFlowEdges` geometry unchanged).
- No change to `recommended-extensions.ts` catalog data.

## Decisions

**D1. Plugin bridge declares the flow channels, keyed per channel.**
- `flows-plugin/src/bridge/index.ts` emits `dashboard:register-event-forward` on activation and on every `dashboard:bridge-ready`, following the subagents precedent. It declares the 15 current channels plus `flow:decision` → `flow_decision`.
- Keys: step channels (`agent-*`, `subagent-tool-*`, `assistant-text`, `thinking-text`, `loop-iteration`, `decision`) are `stream` keyed `stepId`; `flow:flow-started` / `flow:complete` are `stream` keyed `flowName`; `flow:auto-decision` is `stream` keyed `agentName`; keyless `flow:summary-*` / `flow:autonomous-mode-changed` stay `live`, which is today's drop-while-not-ready behaviour.
- `stream` replaces today's drop-while-not-ready (`forwardBusEvent`) for every keyed channel, so a run starting during a reconnect no longer loses events. Drain order follows the buffer's global sequence. The 16 channels stay under the per-plugin cap of 32 (`event-forward-declaration.ts:41`).
- Removed: `FLOW_EVENT_MAP` (and its `bridge.ts:1909` spread) and the `flow_*` entries of `RESERVED_EVENT_TYPES`.
- Anti-spoofing replacement (generic): a **new** owner index keyed by the forwarded `as` type, alongside the existing channel-keyed first-owner-wins rule (`plugin-event-forward-registry.ts:114-131`, keyed by `spec.channel` today). A declaration whose `as` type is already owned by another `pluginId` is rejected and counted in `/api/health`. `pluginId` is self-asserted, the same trust level as any pi extension, which could already emit on the bus; the rule stops collisions and accidental hijack, not a malicious extension.
- The forwarding `stream` path is separate from the subagent buffer: `forwardBusEvent`'s subagent branch (`flow-event-wiring.ts:69-93`) is untouched.
- Alternative rejected: keep the core map and add `flow:decision`. That keeps the coupling this change exists to remove.

**D2. Commands via `plugin_action` + a plugin route; core message types deleted.**
- Client components dispatch `plugin_action {pluginId: "flows", action}`. The action set is exactly six: `flow.abort`, `flow.toggle-autonomous`, `flow.dismiss-summary`, `flow.run` (exists), `flow.delete` and `flow.set-edit-mode`. Unknown actions are logged and dropped.
- The manifest `emits` lists every relayed event: `flow:run`, `flow:set-edit-mode`, `flow:abort`, `flow:architect-abort`, `flow:toggle-autonomous`, `flow:summary-dismissed`, `flow:delete-request`, `flow:notify`.
- ACP: the `plugin_action` handler and the route both refuse a session whose driver is `acp` with `UNSUPPORTED_FOR_ACP`, before any relay (the guard that `acp-guard.ts` gave the old message types).
- The plugin server validates and relays fixed event names via `emitEventToSession`. `flow.abort` emits both `flow:abort` and `flow:architect-abort`, preserving today's `dispatch.ts:442` behaviour. `flow.delete` emits `flow:delete-request` + `flow:notify`, as `dispatch.ts:259-260` does today.
- New route `POST /api/plugins/flows/control {sessionId, action, flowName?, task?, enabled?}` (operate authority, network guard, like `packages/automation-plugin/src/server/routes.ts`) accepts the same six actions and replaces `POST /api/session/:id/flow-control`, which accepted only `abort` / `toggle_autonomous` (`session-api.ts:531-541`). The MCP tools manifest, `verb-tiers.generated.ts` and the bus verbs are regenerated. The `pi-dashboard` skill commands keep their names (`dashboard-flow-abort`, `dashboard-flow-auto`) and call the plugin route.
- ACP sessions: the plugin route returns the same `UNSUPPORTED_FOR_ACP` answer `session-api.ts:548` gives today.
- Alternative rejected: a deprecated core alias for one release (user decision: drop, note in CHANGELOG).

**D3. Generic replay opt-in in the plugin manifest.**
- The manifest gains `pi-dashboard-plugin.replayEntryTypes: string[]` (flows: `["flow-event"]`). An entry type holds `{seq, eventType, data}` records already in protocol form; extra fields (pi-flows adds `flowRunId`) are tolerated and ignored.
- `state-replay.ts` takes the declared set as an argument and replays matching custom entries seq-sorted. Declared types are excluded from the `custom_entry` / custom-message replay paths and from live `custom-entry-forward.ts`.
- Manifest, not the runtime declaration, because replay runs for offline sessions with no live bridge. The server reads manifests at discovery; the bridge reads them when it loads plugin bridges.
- Disabled plugin: its types are not declared, so its entries fall back to the generic hidden path (no `custom_entry` card; same "harmless" contract as today).

**D4. `dashboard:commands-changed`.**
- The core bridge listens on this channel and resends `commands_list`, replacing the core listeners on `flow:rediscover` / `flow:complete` (`flow-event-wiring.ts:183-184`).
- The flows plugin bridge subscribes to those pi-flows events with its own `pi.events.on` (a plugin bridge is a pi extension; this is not core forwarding) and emits `dashboard:commands-changed`.
- Flows disabled: no resend on rediscover; `commands_list` refreshes on the next generic trigger. Accepted, since flows is off.

**D5. Flow types move to `flows-plugin/src/types.ts`.**
- `FlowAgentStatus`, `FlowAgentCardConfig`, `NodeKind`, `FlowAgentState`, `FlowState` move (`packages/shared/src/types.ts:1583-1680`). `SessionState` has no flow field today (only comments mention `flowState`: `types.ts:240`, `server/src/session/event-status-extraction.ts:240`); the plugin keeps its slice through its registered session-event reducer and server `state-store.ts`.
- `flowState` / `activeFlow*` readers in core are removed.
- Stale requirements with no implementation are REMOVED: `flow-server-state` "Server tracks per-session flow metadata", `event-reducer-decomposition` "Flow reducer extraction", `flow-event-bridge` "Bridge routes /flows:delete through session.prompt".

**D6. Reducer: fan-out, decision, skipped.**
- **Item key.** Every event carrying `itemIndex` (started, complete, error, tool, text, thinking) keys its card as `<stepId>[<i>]` under a group record `groups[stepId] = [...]`. The pre-listed step card becomes the group parent. `flow_agent_error` with `itemIndex` targets the item; without it, the group parent.
- **Parent status.** running if any item runs; else error if any failed (soft); else complete. Rollup counts ok / failed.
- **`flow_decision`.**
  - Stores `{labels, routes, routeError}` on the decision card.
  - Marks unchosen branch targets `skipped`.
  - On loop re-entry the group's stale results are overwritten as `skipped`, mirroring pi-flows 0.10.
- **Parent precedence** (first match wins): any item `running` or started-but-pending → `running`; any item `error` → `error` (outcome `hard` if any item is hard, else `soft`); any `blocked` → `blocked`; all items `skipped`, or zero items → `skipped`; else `complete`.
- **Errored decision.** A `flow_decision` with `routeError` marks nothing `skipped`; the decision card shows the error. Loop re-entry overwrites only the targets of that decision's own group.
- **Status type.** `FlowAgentStatus` gains `skipped`. `flow_complete` never downgrades a `skipped` card.
- **Graph.** The live graph stays name-first; it gains short status words only (MODIFIED `flow-card-status` "FlowGraph renders the new node set minimally"). `flowStateToGraphSteps` labels skipped nodes, adds an `xN (k failed)` count to fan-out nodes and the chosen routes to decision nodes. `FlowGraphStep.status` accepts `skipped`, rendered as the pending style plus the word "skipped" (colour is never the sole channel).
- **Static preview.** `flow-yaml-parse.ts` accepts object-form branches (`{to, ...}`).

**D7. Graph-first panel.**
- Expanded `FlowDashboard` = header + graph (+ question queue, YAML button) + an **Agent cards** section.
- The section is a disclosure button: `aria-expanded`, `aria-controls`, ≥44 px below `sm`, ≥32 px from `sm`.
- Its header shows the step count (a fan-out group counts as one) and `SettingsStatusPill` state pills for done / running / failed / skipped.
- **Default collapsed.** `FlowCollapseKind` gains `"cards"`, persisted per session like `"dashboard"`. The panel default stays collapsed (`FLOW_COLLAPSE_DEFAULT`).
- **Node click.** Clicking a graph node selects the step, opens the section and scrolls the card (or fan-out group) into view (`block: "nearest"`, no smooth scroll under reduced motion). Clicking the same node again clears the selection and leaves the section open.
- The mobile collapsed bar is unchanged. The approved mockup: `mockups/2026-11-04-flows-plugin-update/` frame 3.

**D8. Boundary gate.**
- `scripts/check-plugin-boundary.mjs` gains a literal check: a string literal starting `flow:` / `flow_` / `flow-`, or containing `pi-flows`, in non-test core sources (`packages/{extension,server,shared,client}/src`) fails unless allowlisted in `plugin-boundary-allowlist.json`.
- Comments are ignored. Generated files built from plugin manifests (`packages/client/src/generated/plugin-registry.tsx`) are exempt as a class; `verb-tiers.generated.ts` is regenerated clean.
- Every current hit gets a disposition in the tasks; the dead `useDebugToolsVisible.ts` names are deleted.
- `flow:get-available-models` (`provider-register.ts:809,1197`) is renamed `models:get-available`; pi-flows 0.10 no longer emits it.

## Risks / Trade-offs

- **Old browser tab sends `flow_control` after upgrade.** The type is no longer routed; a test pins that it causes no side effect. A reload picks up the new client. Accepted.
- **Durable replay KNOWN BLOCKER carries over.** pi persists custom entries only after the first assistant message (`openspec/specs/on-demand-session-replay/spec.md`, KNOWN BLOCKER). A flow-first session that is reloaded before then has no `flow-event` entries on disk, so generic replay yields nothing, exactly as today. Not fixed here.
- **External scripts calling `/api/session/:id/flow-control` break.** BREAKING in CHANGELOG; the `pi-dashboard` skill script moves to the plugin route in this change.
- **Flows plugin disabled means no flow events forwarded.** That is the intent (the `flows-plugin` disabled contract). Persisted `flow-event` entries stay hidden on replay.
- **Pending runs during a reconnect.** `stream` buffers per key. A long-running fan-out with many items can grow the buffer, which is bounded by the existing `StreamForwardBuffer` caps. → Covered by the `/api/health` plugin-forward counters.
- **Stream key budget shared with subagent streams.** `StreamForwardBuffer` keys are global per bridge (`stream-forward-buffer.ts:49-50,105`); a large fan-out adds one key per step (items share their step's key). → Pressure test with a fan-out plus subagent entry frames; eviction precedence is the buffer's existing policy.
- **Automation `flows.run`.** It relays `flow:run` into sessions the automation itself spawned (pi driver), so the new ACP refusal is not needed there; unchanged.
- **`subagent-queue-visibility` merge.** Both touch `flow-event-wiring.ts`. → This change leaves `SUBAGENT_EVENT_MAP` and its exports intact; whichever lands second rebases.

## Migration Plan

1. Land the generic seams first (replay opt-in, `commands-changed`, reserved-type removal), with tests.
2. Flows plugin: declaration, `plugin_action` cases, plugin route, types and reducer.
3. Remove the core flow code. Regenerate the MCP tools manifest and bus verbs. Update the skill script and CHANGELOG (BREAKING).
4. Graph-first panel.
5. Boundary literal gate (last, so it guards the cleaned tree).

Rollback: revert the merge. No persisted data changes; `flow-event` entries are untouched on disk.
