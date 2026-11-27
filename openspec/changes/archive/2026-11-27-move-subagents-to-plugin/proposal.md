# Proposal

## Why

Subagent code is spread across core: `packages/extension`, `packages/server`, `packages/shared` and `packages/client` name subagent channels, event types, wire types, state, config and buffering. The 2026-06-13 change `extract-subagents-as-plugin` set out to remove the core event map. It never did, and later fixes added more subagent code to core. Much of that code was written against producer versions that can no longer run: the dashboard needs pi ≥ 1.6.0, so the lowest runnable `pi-dashboard-subagents` is 0.2.6.

Four defects follow from this:

- Long sessions show background rows as `unknown · N steps` with an empty task and a gapped stream. The windowed (head/tail) replay drops `subagent_created` and the early `subagent_entry` frames.
- An over-size `subagent_completed` becomes `{__truncated}` and loses its `id`, so the run is never finalized. Producer bus events still carry full payloads.
- The plugin reconcile queries `subagents:registry` and stop `verdicts`. No producer provides either; 0.7.0+ provides `subagents:list` / `subagents:get`. As a result the ghost-row fix (#1151) never runs.
- Core mechanisms are obsolete: the tick throttle (the producer batches to 250 ms since 0.2.5), the bus-path strip (ticks carry no `entries` since 0.3.0), and resync (its snapshot carries no `entries` since 0.3.0, so it can't restore a timeline).

## What Changes

- **Ownership rule.** Every subagent contract lives in `packages/subagents-plugin/`: wire types, event names, session state, buffering, payload trimming, store policy, orphan heal, delivery keys, config and the heap budget. Core exposes only generic plugin APIs. A tree-wide boundary check fails when a subagent contract identifier appears in core or in dashboard-plugin-runtime.
- **New generic core seams**, available to any plugin:
  - **Manifest-declared event ownership.** The existing manifest `eventTypes` replaces the core reservation of `subagent_*`. A plugin bridge may declare channels for the types it owns. Channels can share a `latest` slot per key (`group`), and retention budgets become per plugin.
  - **Windowed-replay carry.** A plugin server returns priority-ordered gap events, sent as one `plugin_event_carry` frame and applied only through the owning plugin's reducer slice.
  - **Plugin store policy.** For owned types and claimed tools, the plugin supplies the elision, placeholder identity fields, stored-event collapse, and trim pins.
  - **Plugin session-end heal.** A new `ctx.onSessionStatusEnded` fires on every real session end (not on relocation, not during replay); the existing `ctx.onSessionEnded` is unchanged. `ctx.appendEvent` appends owned event types.
  - **Per-tool `tool_execution_update` filter**, declared as data and accepted only from the plugin that claims the tool.
  - **Owner delivery policy.** A plugin server supplies the defer key and the bounded deferred copy of its owned event types.
  - **Generic per-plugin client state** (`SessionState.pluginState`), and finalizer lookup by owned event type.
  - **Producer version floor.** New `requires.piExtensionVersions`.
- **Removed (BREAKING for the wire/config):**
  - `SubagentTickThrottle` and `subagentTickThrottleMs` (with its migration and health summary).
  - The bus-path strip and `PI_DASHBOARD_SUBAGENT_STRIP`.
  - The resync path (`subagent_resync_request` on every protocol, bridge snapshots, server routing, the client cadence hook and the `App.tsx` reconnect loop).
  - The stop-answer path. No producer reports a stop outcome, and by owner decision there is no synthesized answer.
  - Tick telemetry, the unused `event-reducer.ts` re-exports, and the `get_subagent_result` / `steer_subagent` entries in `tool-summary.ts`.
- **Fixed:**
  - The `started` arm reads `details.subagentType` / `details.description` / `details.displayName` and never shows `unknown`.
  - A truncated terminal frame keeps its `id` and ends the row.
  - The registry reconcile uses `subagents:list` and ends only background rows.
  - The plugin requires producer ≥ 0.7.0 and shows a notice below that.
- Absorbs the empty `openspec/changes/add-plugin-session-close-hook/` placeholder; that directory has been removed.

## Capabilities

### New Capabilities
- `plugin-replay-carry`: a plugin server contributes priority-ordered gap events to a windowed session replay, applied only through its reducer slice.
- `plugin-tool-update-filter`: a plugin declares, as data, fields to drop from `tool_execution_update` of a tool it claims.
- `plugin-synthetic-events`: a plugin server is told about every real session end and can append and broadcast events of types it owns.
- `plugin-store-policy`: a plugin decides elision, placeholder identity, stored-event collapse and trim pins for event types it owns and tools it claims.
- `subagents-core-boundary`: no subagent contract identifier in core, enforced by a convention check, and a producer version floor.

### Modified Capabilities
- `plugin-event-forwarding`: manifest-declared ownership of event types, shared `latest` groups, and per-plugin retention budgets.
- `in-memory-event-buffer`: the over-size placeholder keeps owner-declared identity fields, and elision is owner-supplied.
- `catch-all-event-forwarding`: the core rename map and the subagent tick-coalescing exception are removed; subagent channels are plugin-declared.
- `bridge-decomposition`: `flow-event-wiring` holds only generic helpers.
- `flow-event-bridge`: `SUBAGENT_EVENT_MAP` is no longer exported.
- `ws-frame-delivery-policy`: defer keys and deferred copies of per-session events come from the owning plugin's delivery policy.
- `session-end-orphan-heal`: the subagent heal is performed by the owning plugin on the same end seams, and the tool-call heal carries owner-named identity fields instead of `agentId`.
- `dashboard-plugin-loader`: `requires.piExtensionVersions`, and finalizer lookup by owned event type.
- `subagent-live-timeline`: reload restores the timeline under a windowed replay. The legacy-producer requirement is removed.
- `subagent-details-payload`: only `Agent` `tool_execution_update` ticks are stripped, by the plugin filter. The pull-path requirement is removed.
- `subagent-live-cadence`: the bridge throttle and its migration are removed.
- `subagent-live-detail-reliability`: gap buffering comes from plugin-declared grouped `latest` retention. Resync is removed.
- `subagent-liveness-reconcile`: the registry comes from `subagents:list` (including `idle`). Snapshots end background rows only. The stop-answer requirements are removed.
- `subagents-plugin-state`: the generic per-plugin slot; `useSessionSubagents` moves into the plugin.
- `background-subagent-display`: rows never show `unknown`, and a truncated end still ends the row.

## Impact

- **Core extension:** delete `subagent-frame-buffer.ts`, `subagent-frame-strip.ts`, `subagent-forward-sites.ts` and `subagent-tick-throttle.ts`, the `SUBAGENT_EVENT_MAP` branch of `flow-event-wiring.ts`, and the subagent wiring in `bridge.ts` and `bridge-handlers/{lifecycle,dispatch,forwarders,instance}.ts`. Add manifest ownership, `latest` groups, per-plugin budgets and the tool-update filter registry.
- **Core server:**
  - Remove subagent logic from `memory-event-store.ts` (elision, delta collapse, telemetry), `event-wiring.ts` (orphan heal), `browser-gateway.ts` (defer keys and resync routing), `session-action-handler.ts`, `routes/system-routes.ts`, `config-api.ts` and `cli.ts`. 
  - Add the replay-carry, store-policy, delivery-policy, `appendEvent` and `onSessionStatusEnded` seams. Rename `pairing/subagent-resync-routing.ts` to a generic requester registry.
- **Core shared:** move `dashboard-plugin/subagent-types.ts` and `subagentHeapBudget` into the plugin. Remove the resync message types, `subagentTickThrottleMs` and the reserved `subagent_*` names. Add the `plugin_event_carry` frame and `requires.piExtensionVersions`.
- **Core client:** replace `SessionState.subagents` with `pluginState`. Remove the `"Agent"` finalizer literals, the resync loop and the dead re-exports. Apply `plugin_event_carry` through slices.
- **Plugin:** bridge (lifecycle declarations, filter, `subagents:list` reconcile), server (carry, store policy, delivery policy, session-end heal), client (types, state, idempotent arms, row fallbacks, notice), manifest (`piExtensionVersions`).
- **Tooling:** new `scripts/check-subagent-boundary.mjs` plus allowlist, run by `npm test`.
- **Producer dependency:** `@blackbelt-technology/pi-dashboard-subagents` ≥ 0.7.0. No producer release is needed.

## Discipline Skills

- `doubt-driven-review`: a cross-boundary removal of wire messages and a config key.
- `performance-optimization`: the replay carry and per-plugin budgets on the large-session path.
- `code-simplification`: deleting obsolete mechanisms.
- `systematic-debugging`: the `unknown`-row and lost-`id` defects.
- `security-hardening`: manifest ownership and the tool-filter gate accept input from other extensions.
