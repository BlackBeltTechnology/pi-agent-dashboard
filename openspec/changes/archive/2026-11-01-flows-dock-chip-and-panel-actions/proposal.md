# Proposal: flows-dock-chip-and-panel-actions

## Why

Flow actions (Run, Open, New/Edit, Delete) sit two clicks deep in the session card's actions menu, behind a faint edge pill, and are absent on mobile. They also vanish when the session's available-flows list is empty, and that list is fragile: core forwards `flows_list` only to browsers subscribed at that instant and keeps no copy, so a session opened while its bridge is busy can show no Run / Open even though flows exist. This was observed on a session that had just run `batch:apply`; the unretained forward is the likely cause and task 1.1 confirms it. The flow list also runs through core (bridge, server, client, shared protocol), which breaks the plugin decoupling the dashboard has been moving to.

## What Changes

- **FLOWS chip in the composer dock.** The flows plugin claims the existing `composer-context-group` slot. The chip shows only when the session has at least one flow: the open or last flow's name and status, then Run, Open and an Edit (pencil) button. The pencil opens a popover with Edit…, New flow…, Delete… and the per-project edit-mode toggle.
- **Actions in the flow panel header.** The completed-flow header gains Run again, Open flow… and Edit…; the live header gains Open flow… and Edit… beside Abort. Run and Open stay disabled while a flow runs ("A flow is running").
- **The flow panel never opens on its own.** When a flow starts, finishes or fails, the panel shows only its one-line header (name, status, actions). It expands only when the user expands it or chooses Open flow…. The user's choice persists per session.
- **Session actions menu shrinks.** For a session with flows, the flows plugin contributes nothing to the menu. For a session with no flows it contributes exactly one item: **New flow…** when edit mode is on, or "Turn on edit mode for this project" when it is off. While the flow list is still unknown it contributes nothing.
- **Plugin-owned flow catalog.** The flows plugin's bridge publishes the session's flow catalog through declared event forwarding (`latest` delivery), the same mechanism the subagents plugin uses. The catalog rides the session event store, so it is replayed on cold load and late subscribe. The bridge publishes only when pi-flows actually answered, so a not-yet-loaded pi-flows never wipes the catalog, while deleting the last flow does clear it. After a server restart the plugin server and client ask sessions to report again, and a catalog change in one session makes same-folder sessions re-read their flows. The plugin server reads the same events for automation's flows-for-folder lookup.
- **Catalog timings in flows settings.** The catalog ask limit and the re-ask intervals, attempts and window are flows plugin settings with defaults and ranges; the bridge's 300 ms publish debounce stays fixed.
- **BREAKING (internal protocol): core flow-list path removed.** `flows_list`, `request_flows_refresh`, the shared `FlowInfo` type, the bridge's `flow:list-flows` probe, its `/<flow-name>` slash fast-path, and the client's `flowsList` session-data publish are deleted from core. pi-flows' own registered flow commands keep `/<flow-name>` working; while the agent is streaming, a typed `/<flow-name>` now follows the same delivery rule as any extension command instead of starting at once.
- Mockup: mockups/ (in this change) — `ad-failed.png`, `ad-running.png`, `ad-idle.png`, `ad-picker.png`, `index.html`.

## Capabilities

### New Capabilities
- `flows-catalog`: how a session's available flows reach the dashboard. Plugin-published, replayed with the session, never wiped by a transient empty report; core carries no flow list.
- `flows-dock-chip`: the FLOWS chip in the composer dock's Context lane, its visibility rule, its actions, and its pencil popover.

### Modified Capabilities
- `flows-plugin`: the actions gate. The menu claim narrows to the flowless entry point, and availability reads the plugin catalog instead of core `flowsList`. Automation's flows-for-folder lookup reads the catalog.
- `command-routing`: the bridge's own flow-name step is removed; typed `/<flow-name>` is handled as the pi-flows-registered command.
- `flows-edit-mode-settings`: where New flow… / Edit… and the per-project edit-mode item appear (chip popover, or the menu for flowless sessions), and the edit-mode re-read when the popover opens.
- `flow-pre-run-attach`: Open flow… moves from the session actions menu to the chip and the flow panel header.
- `flow-summary-view`: the completed-flow header gains Run again / Open flow… / Edit…, and the completed panel defaults to collapsed.
- `flow-panel-collapse-persistence`: the panel defaults to collapsed and never auto-expands; Open flow… expands it.
- `flow-controls`: the live flow header gains Open flow… / Edit… beside Abort.
- `session-card-subcards`: FLOWS subcard scenarios reference the plugin catalog, not `flowsList`; the flowless authoring entry point is New flow….
- `session-actions-menu`: the PLUGINS group no longer carries the flows plugin's flow actions for sessions with flows.
- `dashboard-shell-slots`: flow actions render through `composer-context-group` (chip) and the panel headers; `session-card-action-bar` carries only the flowless entry point.
- `flow-list-protocol`: all requirements removed (core no longer carries a flow list).
- `flow-event-bridge`: the bridge no longer resends a flow list on `flow:rediscover` / `flow:complete` and no longer detects flow slash commands itself.
- `bridge-decomposition`: session sync and flow event wiring no longer send `flows_list`.
- `flow-trigger`: the obsolete session-card and header launcher requirements are removed; the button-UI requirement names the chip and headers.
- `flow-card-launcher`: the session-card launcher requirements are removed.
- `session-listing`: the session-card flow launcher requirement is removed.
- `flow-plugin-e2e`: the harness scenario launches from the dock chip.
- `on-demand-session-replay`: availability after cold load comes from the replayed catalog; the follow-up note is resolved.

## Non-goals

- Moving flow progress forwarding (`FLOW_EVENT_MAP`, `flow_*` event types) or server-side flow metadata (`flow-server-state`) out of core. Those are a separate pipeline and a follow-up change.
- Opening a second flow while one runs (multi-flow tabs).
- A user toggle to hide the chip.

## Discipline Skills

- `systematic-debugging`: confirm why the flow list was empty on the observed session (task 1.1) before the publisher design is built on that cause.
- `doubt-driven-review`: the core protocol removal (`flows_list`, `request_flows_refresh`, `FlowInfo`) is irreversible for older bridges; review before it stands.
- `review-code`: non-trivial multi-package change before commit.
- `observability-instrumentation`: the catalog channel's retained and dropped counts are already reported in `/api/health.pluginEventForward`. Confirm the new channel appears there.

## Impact

- **flows-plugin:** `src/bridge` (catalog publisher plus forward declaration), `src/server` (`onEvent` catalog feed into `stateStore`), `src/client` (new chip claim, panel header actions, shrunk `SessionFlowMenuClaim`, shared flow-actions hook, catalog hook replacing `useSessionData("flowsList")`), `src/reducer.ts` (consumes `flow_catalog`), `package.json` (new `composer-context-group` claim), `src/configSchema.json` and `src/client/FlowsSettings.tsx` (catalog timing settings).
- **Core (removals only):** `packages/extension` (`bridge.ts`, `session-sync.ts`, `flow-event-wiring.ts`, `command-handler.ts`, `bridge-handlers/*`), `packages/server` (`event-wiring.ts` flows_list fan-out, `acp-bridge/server-requests.ts`), `packages/client` (`useMessageHandler.ts`), `packages/shared` (`protocol.ts`, `browser-protocol.ts`, `types.ts` `FlowInfo`, `event-forward-declaration.ts` passthrough list), `packages/dashboard-plugin-runtime` doc comments.
- **Compatibility:** a newer server with an older bridge simply ignores `flows_list`; an older dashboard client with a newer bridge loses Run/Open until updated (same release train).
