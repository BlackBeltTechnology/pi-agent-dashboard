# Design: flows-dock-chip-and-panel-actions

## Context

See proposal.md (Why). Current state, with citations:

- **Flow list runs through core.** The bridge probes pi-flows synchronously (`packages/extension/src/bridge.ts:237` `getFlowsList` emits `flow:list-flows`). It sends `flows_list` on register/resume (`packages/extension/src/session-sync.ts:185`, `:339`), on `flow:rediscover` / `flow:complete` (`packages/extension/src/flow-event-wiring.ts:178-187`), on `request_commands` and `request_flows_refresh` (`packages/extension/src/command-handler.ts:1024-1031`, `:1203-1210`). The server forwards it only to browsers subscribed at that instant and keeps no copy (`packages/server/src/event-wiring.ts:2233-2255`), unlike `commands_list`, which it retains (`:2215-2220`). The client publishes it as session data `flowsList` (`packages/client/src/hooks/useMessageHandler.ts:953-957`).
- **Observed failure.** On session `unify-capabilities` the menu showed New / Edit… but not Run / Open: `commandsList` was known, `flowsList` was empty. `batch:apply` exists at `.pi/flows/flows/batch/apply/flow.yaml`, and pi-flows answers `flow:list-flows` from the same map it runs flows from (`pi-flows/extensions/flow-engine/index.ts:582-589`). The card showed "unresponsive" at the time. The unretained, subscriber-only forward is the likely cause (to be confirmed, task 1.1).
- **Task 1.1 finding (reproduction note): cause (a), the unretained forward.** Reproduced by reading the live path end to end:
  1. pi-flows fills its flow map at extension load (`init(pkgRoot, projectRoot)` at `pi-flows/extensions/flow-engine/index.ts:166`), before it registers its `flow:list-flows` listener (`:582`). An answered probe is therefore never a premature empty: (b) is ruled out for any probe made after pi-flows loaded.
  2. The bridge sends `flows_list` only at register/resume, `flow:rediscover`/`flow:complete`, `request_commands` and `request_flows_refresh`. A turn in progress (`batch:apply` was running) triggers none of these.
  3. The server's `flows_list` branch (`packages/server/src/event-wiring.ts:2233`) calls only `browserGateway.sendToSubscribers` and stores nothing, while `commands_list` is retained (`sessionCommandRegistry.retain`). A browser subscribing after the register-time send (here: opening the card while the bridge was busy and marked unresponsive) gets `commands_list` on replay but never a `flows_list`, so `flowsList` stays empty — exactly the observed New / Edit… without Run / Open.
  Conclusion: (a). The design (catalog as a replayed `latest` event) addresses it; no return to planning.
- **Flows UI reads core data.** `useSessionData("flowsList")` in `packages/flows-plugin/src/client/FlowDashboard.tsx:693`, `SessionFlowMenuClaim.tsx:71`, `FlowsCommandRoutes.tsx:70,178,218`. The menu claim owns every flow action and dialog (`SessionFlowMenuClaim.tsx:97-260`).
- **Plugin server store never fed.** `stateStore.setFlows` (`packages/flows-plugin/src/server/state-store.ts:53`) has no caller, so `makeFlowsForCwd` (`packages/flows-plugin/src/server/index.ts:30-45`) always returns `[]` for automation.
- **Decoupled precedents.** subagents declares forwarded channels from its own bridge (`packages/subagents-plugin/src/bridge/index.ts`; mechanism in `docs/architecture.md` "Plugin-declared event forwarding", `packages/shared/src/event-forward-declaration.ts`). goal uses `dashboard:plugin-message` plus `registerPiHandler` plus `broadcastToSubscribers` (`packages/goal-plugin/src/server/index.ts`). flows already reports files over a private lane with a one-shot client fetch (`packages/flows-plugin/src/bridge/flow-files-reporter.ts`, `packages/flows-plugin/src/client/flow-files.ts:61-88`).
- **Slot for the chip.** `composer-context-group` renders in the dock's Context lane with `{ session }` and is not disabled while streaming (`packages/dashboard-plugin-runtime/src/slot-consumers.tsx:457-486`; spec `dashboard-shell-slots`). The runtime exports the `ComposerContextGroup` primitive (`packages/dashboard-plugin-runtime/src/public.ts:146`). quota-plugin is the existing claimant.
- **Panel headers.** Live: `FlowDashboard.tsx:270-320`. Completed: `FlowSummary.tsx:96-125`. Slot priority (running wins, discards an attachment): `packages/flows-plugin/src/client/flow-idle-state.ts:203-232`.

## Goals / Non-Goals

**Goals:** core carries no flow list; the catalog survives late subscribe, reload and server restart; one shared action implementation for chip, headers and menu.

**Plugin files importing core `FlowInfo` (must switch to the plugin type, D8):** `packages/flows-plugin/src/server/state-store.ts`, `src/server/render-actions.ts`, `src/client/FlowDashboard.tsx`, `src/client/FlowsCommandRoutes.tsx`, `src/client/SessionFlowMenuClaim.tsx`, and tests `src/__tests__/{session-flow-actions-open,session-flow-actions-edit,render-actions,flow-dashboard-claim-attach,flow-idle-state}.test.*`.

**Non-goals:** see proposal. Also: no change to the flow-files report lane's file-path contract; no change to slot priority.

## Decisions

### D1. Catalog rides declared event forwarding (`latest`)

The flows bridge declares `{ pluginId: "flows", channels: { "dashboard-flows:catalog": { as: "flow_catalog", delivery: "latest", key: "catalogKey" } } }` and re-declares on `BRIDGE_READY_CHANNEL`, copying subagents. The payload is `{ catalogKey: "catalog", flows: FlowCatalogEntry[] }`; the entry shape (`name`, `description`, `source`, `taskRequired`) moves into the plugin.

- The channel avoids the `flow:` prefix, which core's `EVENT_BUS_MAP` owns; validation rejects channels already in it (`event-forward-declaration.ts`).
- `flow_catalog` is not in `RESERVED_EVENT_TYPES` (`event-forward-declaration.ts:54-75`) and falls under the plugin's owned `flow_*` prefix (`packages/flows-plugin/package.json` `eventTypes`).
- The flows reducer consumes `flow_catalog` into session state (latest wins). The shell then never groups it as an unconsumed owned-event row (manifest `eventTypes` contract, `packages/shared/src/dashboard-plugin/manifest-types.ts:380-387`).

**Alternatives.**
- goal-style plugin message, server store and broadcast: needs a store, a fetch on mount and a push to keep in sync, while replay is already solved for events.
- Extending the flow-files lane: one-shot fetch today, so it would need its own push channel. Rejected as two mechanisms for one fact.

### D2. Publish only answered probes; no settling memory

The shared probe helper returns `undefined` when no listener set `probe.flows` (pi-flows absent or not loaded yet) and an array otherwise. The publisher skips `undefined` and publishes arrays as-is, so deleting the last flow publishes an empty catalog. Task 1.1 verified that pi-flows fills its flow map before its `flow:list-flows` listener can answer, so an answered empty list is always real.

**Alternative rejected:** a "never replace non-empty with empty" rule. It lived in bridge memory, was lost on bridge reload, and kept deleted flows forever within a session (both doubt reviewers flagged this). The likely cause of the observed empty list is the unretained core forward, not an empty probe; task 1.1 must confirm this before implementation, and a different finding returns the change to planning.

### D3. One collector; triggers plus a client ask for restart survival

A new `flow-catalog-publisher.ts` sits beside `flow-files-reporter.ts`. Both share one probe helper (D2). Numbers: 300 ms publish debounce, fixed (same as the reporter, `flow-files-reporter.ts:33`). The other values are flows plugin settings: 2 s per-session catalog-ask limit on the server, kept separate from the files ask; client re-ask every 5 s, up to 12 attempts per view; server-start re-ask every 5 s for 60 s. See D11.

- **Bridge triggers (debounced):** `session_start`, `flow:(un)register-(flows|agents)-dir`, `flow:rediscover`, `flow:complete`, publisher attach (bridge load or reload), and the server ask `dashboard-flows:report-files`.
- **Server start:** the plugin server asks every live session (`sessionManager.listActive`) to report, retrying while bridges reconnect. This feeds automation without a browser.
- **Sibling refresh:** see Risks [Decision].
- **Server restart (browser view):** the server's event store is in memory, and a reconnecting bridge fires no attach. So the plugin client, while it views a live session whose catalog is unknown, sends a `plugin_action` `flow.request-catalog`, repeating after the minimum interval for a bounded number of attempts (this also covers a trimmed catalog event and a bridge that was reconnecting during the first ask). The plugin server answers with `emitEventToSession(sessionId, "dashboard-flows:report-files")`, rate-limited per session. This reuses the existing ask path and minimum gap (`packages/flows-plugin/src/server/flow-files.ts:180-210`). No core change.

### D4. Plugin server learns the catalog from `ctx.onEvent`

`registerPlugin` subscribes `ctx.onEvent` and, on `flow_catalog`, calls `stateStore.setFlows(sessionId, flows)`. On session end it clears the entry. This feeds `makeFlowsForCwd` and fixes the uncalled `setFlows`. No core change.

### D5. One client source: `useFlowCatalog(sessionId)`

The hook is derived from the plugin's session state (D1 reducer slice), returning `{ known: boolean, flows }`. Every `useSessionData("flowsList")` site switches to it, and `resolveFlowSlot` receives `flows` from it.

### D6. Shared actions: `useFlowActions(session)` + `<FlowActionDialogs>`

Extracted from `SessionFlowMenuClaim.tsx`. It owns picker, task, edit and delete dialog state, the run / open / edit / delete / new / set-edit-mode dispatches, and the derived flags (`hasFlows`, `anyRunning`, `editMode`, `canDelete`).

Consumers:
- `FlowsContextGroup` (new chip claim)
- `FlowSummary` and `FlowDashboard` headers
- the shrunk `SessionFlowMenuClaim`, which keeps only New flow… and the edit-mode item when `!hasFlows`

Dialogs portal to `body`, so closing the menu or popover never unmounts them (the existing `DialogPortal` contract, `docs/session-actions-menu.md` §3).

### D7. Chip and popover use host primitives only

The chip renders the `ComposerContextGroup` primitive (label `FLOWS`) plus icon buttons sized to the dock minimum. The pencil uses the `ui:popover` primitive (`packages/shared/src/dashboard-plugin/ui-primitives.ts:61`). `useEditModeState` already re-reads on a closed-to-open transition (`packages/flows-plugin/src/client/useEditModeState.ts:62-66`); the chip passes the popover's open state as `menuOpen`.

### D8. Core removals

- **extension:** remove `getFlowsList`, `sendFlowsList`, `inst.getFlowsList` / `inst.sendFlowsList`, the session-sync `flows_list` sends, the flow-list half of `registerFlowEventListeners`, the `request_commands` flow probe, the `request_flows_refresh` case, and the `/<flow-name>` fast-path (`bridge.ts:1494-1502`).
  - pi-flows registers each flow as a command (`pi-flows/extensions/flow-engine/index.ts:462`, re-run on rediscover at `:561-566`), so `/<flow-name> <task>` still reaches pi-flows through extension command dispatch.
- **server:** remove the `flows_list` handler, the sibling `request_flows_refresh` fan-out (`event-wiring.ts:2233-2255`) and `acp-bridge/server-requests.ts:109`.
  - The sibling fan-out is replaced by pi-flows' own `flow:rediscover`, which fires in the session that wrote the flow. Siblings see new flows at their next trigger.
- **client:** remove the `flows_list` case (`useMessageHandler.ts:953-957`).
- **shared:** remove `flows_list` / `request_flows_refresh` from `protocol.ts` and `browser-protocol.ts`; delete the dead, unexported `packages/flows-plugin/src/client/FlowsCommandRoutes.tsx`, `FlowInfo` from `types.ts:787`, and `flows_list` from `RESERVED_EVENT_TYPES`.
  - This is safe: it is a bridge control message, not an event type, and removing it frees nothing another plugin could collide with that core still sends.
- **runtime:** update doc comments in `plugin-context.tsx:410` and `session-data-store.ts:11-15` that name `flows_list`.

### D9. Run / Open disabled while a flow runs

The existing slot priority stays: a running flow wins and discards an attachment (`flow-idle-state.ts:207`). Run and Open are disabled with "A flow is running" everywhere (chip, headers), as the menu did (`SessionFlowMenuClaim.tsx:118-124`).

### D10. Panel defaults to collapsed

`useFlowCollapsePersisted` defaults to `false` (expanded) for a session with no stored state (`packages/flows-plugin/src/client/flow-collapse-storage.ts:74-79`). It flips to `true` (collapsed) for both kinds (`summary`, `dashboard`). Open flow… writes "expanded" for the session after it sets the attachment. The user's reported "collapsed panel reopens on click" is reproduced first (task 5.3); the default change lands only with that cause fixed, since the same cause could reopen a collapsed default. The code path looks correct (`FlowSummary.tsx:48`, `FlowDashboard.tsx:148`, both keyed by session id), so the cause is unknown until then.

**Task 5.3 finding.** Cause: the live panel (`dashboard` key) and the completed panel (`summary` key) persist separately, and the completed panel defaulted to expanded. Collapsing a running flow wrote only the `dashboard` key; when the flow finished, `FlowDashboard` rendered `FlowSummary`, whose `summary` key was unset → expanded. The user saw it the next time they selected the session. Reproduced by `flow-dashboard-claim-attach.test.tsx` "5.3 repro" (fails with the old expanded default, passes with collapsed). The collapsed default fixes it; a same-tab `setFlowCollapsed` lets Open flow… expand a mounted panel.

### D11. Catalog timings live in the flows plugin settings

The five server and client timings are added to `packages/flows-plugin/src/configSchema.json` with defaults and `minimum` / `maximum` bounds, and edited in an "Advanced" group of `FlowsSettings.tsx`. The server reads them through its plugin config accessors at each use, so a save applies at once. The client reads them with `usePluginConfig`. The bridge debounce stays a constant because plugin bridges have no settings channel, and adding one would be core work.

**Alternative rejected:** hard-coded constants. These are tuning values for flows only and the user asked for them in settings.

## Risks / Trade-offs

- **[Risk]** Removing the `/<flow-name>` fast-path changes precedence when a flow name collides with another extension's command. → Mitigation: a test asserts `/batch:apply task` starts the flow through pi-flows' registered command; the collision case is documented as pi command precedence.
- **[Risk]** Mixed versions: a new dashboard client with an old flows bridge gets no catalog, so no chip and only the flowless menu. → Mitigation: the flows plugin ships in the same release train; the bridge is re-registered on server boot (`syncPluginBridges`).
- **[Risk]** The `latest` buffer shares a 64-key budget with `stream` keys across plugins, dropping the oldest key (`packages/extension/src/stream-forward-buffer.ts:9-10`), so the catalog can be evicted while the bridge cannot forward. → The client ask (D3) and the server-start ask recover it; `/api/health.pluginEventForward` reports drops.
- **[Decision]** Sibling refresh moves into the plugin. The core fan-out only re-probed a sibling's in-memory map (`command-handler.ts:1203-1210`), so it never picked up another process's write. Now, when a session's catalog changes, the plugin server asks same-folder siblings to rediscover (re-read disk) and report. This terminates because a sibling whose catalog is unchanged triggers no further asks, and it is rate-limited per session.
- **[Trade-off]** The catalog is visible only after the bridge's first answered publish. Until then the chip and the flowless menu item are hidden (`known: false`); neither is shown on a guess.
- **[Limit]** A flow deleted by hand stays in the chip until the next rediscover. Opening a Run or Open picker asks for a rediscover first, so the deleted flow is never offered for a run. Deletion through pi-flows emits `flow:rediscover` (`pi-flows/extensions/flow-context/index.ts:126`) and clears it at once.
- **[Risk]** The server's memory event store trims non-essential events oldest-first (`packages/server/src/persistence/memory-event-store.ts:386-436`), so a long session can lose its catalog event. → The client's bounded ask (D3) recovers it from the live bridge.
- **[To verify]** The composer dock's compact layout below 520 px renders lanes as summary chips (`composer-dock` "Compact dock below 520 px"). Task 7.2 checks the FLOWS chip is reachable there, so the mobile path is real.
- **[Note]** The chip uses `ComposerContextGroup`'s default read-only outline; its icon buttons keep their own interactive look, as the primitive's contract allows (`dashboard-shell-slots`).

## Migration Plan

Single release. Ship the plugin publisher and the client catalog first in the same PR as the core removals; there is no persisted data to migrate. Rollback means reverting the PR. Old bridges sending `flows_list` to a new server are ignored (no handler).

## Open Questions

- Exact chip copy for a not-started opened flow ("not started" vs "opened"). Copy only, deferrable.
