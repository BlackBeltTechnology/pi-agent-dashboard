# DOX — packages/dashboard-plugin-runtime/src

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `__tests__/manifest-validator-tool-renderer-fields.test.ts` | `tool-renderer` claim fields `expandWhileRunning` (boolean) / `resultPending` (string): carried through, omitted when absent, wrong type + non-tool-renderer slot rejected. See change: decouple-plugins-from-core (task 4.5). |
| `__tests__/secure-context.test.ts` | Tests for `secure-context.ts` (E1–E7). See change: audit-plugin-bundles-non-secure-context. |
| `__tests__/session-event-reducers.test.ts` | Slice/finalizer registry: exact + prefix match, replace-per-plugin, enabled-set filter (inactive until set), unregister. See change: decouple-plugins-from-core (task 4.2). |
| `lazy-claim.tsx` | `lazyClaim(load, name)` — memoized `React.lazy` (keyed loader+name) bound by the generated registry for… → see `lazy-claim.tsx.AGENTS.md` |
| `RoleRef.tsx` | Shared `@role[:level]` display. Exports `RoleRef`, `RoleRefProps`, `RoleRefLabels`. → see `RoleRef.tsx.AGENTS.md` |
| `__tests__/ws-route-registry.test.ts` | Plugin WS route registry decision tables (test-plan #E1-#E3, spec plugin-ws-route): duplicate scope / nested… → see `__tests__/ws-route-registry.test.ts.AGENTS.md` |
| `dependency-graph.ts` | Pure plugin-activation dependency graph. Exports `GraphNode`, `Graph`, `buildGraph`, `transitiveDependents`,… → see `dependency-graph.ts.AGENTS.md` |
| `editor-pane-tab.tsx` | `editor-pane-tab` consumers + opener: `findEditorPaneTabClaim(registry,path)`, `useEditorPaneTabClaim`,… → see `editor-pane-tab.tsx.AGENTS.md` |
| `embedded-app-shell.tsx` | Root-exported, app-kit-free. `EmbeddedAppShell` `{fetch, wsUrl, encodeFolder, decodeFolder, returnTarget}` +… → see `embedded-app-shell.tsx.AGENTS.md` |
| `embedded-app.tsx` | `<EmbeddedApp app basePath folderParam? standaloneUrl? onBack pluginContext?>` via subpath `./embedded-app`… → see `embedded-app.tsx.AGENTS.md` |
| `index.ts` | Package-root barrel. `export * from ./public.js` + `@deprecated` per-specifier re-exports of every `host.ts`… → see `index.ts.AGENTS.md` |
| `public.ts` | Versioned PUBLIC host API (import-mapped in Phase 5; snapshot `host-api-surface.json`). → see `public.ts.AGENTS.md` |
| `host.ts` | HOST-ONLY surface (`./host`): every `*Slot` consumer except `AutomationActionEditorSlot`,… → see `host.ts.AGENTS.md` |
| `sdk.ts` | `./sdk`: bundled pure helpers. `encodeFolderPath`, `decodeFolderPath`, `folderRouteHref(cwd, suffix)`,… → see `sdk.ts.AGENTS.md` |
| `__tests__/runtime-surface-split.test.ts` | Checker-based export-set tests: public ∩ host = ∅, root = public ∪ host, `__reset*` only in test-support, deprecated diagnostic 6385 on root host re-exports, `./context` same module (#E23, #E24). |
| `__tests__/sdk.test.ts` | `./sdk` codec round-trip, `folderRouteHref`, no version exports, no react import (#E25 sdk half). |
| `__tests__/host-api-gate.test.ts` | Host API gate: `evaluateHostApi` decision table + discovery/status integration by source (#E28). |
| `folder-menu-contributions.tsx` | Folder-actions-menu contribution registry — the sibling bridge from a pill-grid slot section to the folder… → see `folder-menu-contributions.tsx.AGENTS.md` |
| `intent-renderer.tsx` | Shell-side React component. Walks `IntentNode` tree, resolves `primitive` name via `useUiPrimitiveOrNull`,… → see `intent-renderer.tsx.AGENTS.md` |
| `intent-store.ts` | Client store for `plugin_intents` broadcasts. Exports `IntentKey`, `keyToString`, `IntentStoreEntry`,… → see `intent-store.ts.AGENTS.md` |
| `manifest-validator.ts` | Hand-rolled manifest validator. Throws `ManifestValidationError` with `pluginId` + `reason`. No Zod dep. → see `manifest-validator.ts.AGENTS.md` |
| `manifest-validator.ts` | Hand-rolled manifest validator. Throws `ManifestValidationError` with `pluginId` + `reason`. No Zod dep. → see `manifest-validator.ts.AGENTS.md` |
| `oauth-flow-client.ts` | `createOAuthFlowClient(fetch?)` / `oauthFlowClient` — `status(flowId)` / `input(flowId,value)` /… → see `oauth-flow-client.ts.AGENTS.md` |
| `plugin-action-bridge.ts` | Client→server `plugin_action` bridge. Exports `PluginActionMessage`, `setSender(sender)` (called by… → see `plugin-action-bridge.ts.AGENTS.md` |
| `plugin-context.tsx` | `PluginContextProvider`, `CurrentPluginLayer`, `useCurrentPluginId()` (plugin identity for registration APIs;… → see `plugin-context.tsx.AGENTS.md` |
| `prompt-component-registry.ts` | PromptBus component registry. Built-in types `generic-dialog` (inline) + `architect-prompt` (widget-bar). → see `prompt-component-registry.ts.AGENTS.md` |
| `secure-context.ts` | `randomUuid()` / `copyText()` — non-secure-context safe (v4 from `getRandomValues`; textarea+`execCommand`… → see `secure-context.ts.AGENTS.md` |
| `session-data-store.ts` | Per-session client-side data store. Exports `subscribeSessionDataKey(key, cb)` — all-sessions-for-a-key subscription. Reset cleanup teardown. See change: add-flows-subcard. |
| `session-event-reducers.ts` | Plugin contributions to the pure session event reducer: types `SessionEventReducerSlice` (`eventTypes` exact/`prefix_*`, pure `reduce(state,event,opts)`) + `ToolRowFinalizer` (`toolName`, optional `onToolExecution`/`onSessionEvent`, `undefined` = decline) + `ToolRowFinalizerOpts` (`isLive`, `reduce` = re-enter shell reducer for synthesized events, `prior` = pre-event state on `tool_execution_update`) exported from `public.ts`; registration (`registerSessionEventReducer`/`registerToolRowFinalizer`/`unregisterSessionReducers`), lookups (`findSessionEventReducer`/`findToolRowFinalizer`) and `setSessionReducerEnabledSet` exported from `./host`; `__resetSessionReducersForTests` from `./test-support`. Registration is declarative (client entry exports → generated registry → shell). Filtered by the enabled set exactly like claims; one slice per plugin id. Finalizer contract: running-only, never clobber a real terminal row, healedBy event never changes a terminal plugin state, record heal provenance. `onSessionEvent` is offered every slice-owned event + `agent_settled`; hooks decline types they do not settle. See change: decouple-plugins-from-core (tasks 4.2, 4.6). |
| `session-events-store.ts` | Module-level per-session `DashboardEvent` side-channel store for plugins. → see `session-events-store.ts.AGENTS.md` |
| `settings-fields.tsx` | Shared settings field family for core + plugin settings. Exports `FieldShell`, `NumberField`, `SelectField`,… → see `settings-fields.tsx.AGENTS.md` |
| `slot-claims-invalidation.ts` | Slot-claims invalidation store (design D3) — the re-render nudge for gates whose signal arrives after first… → see `slot-claims-invalidation.ts.AGENTS.md` |
| `settings-draft-context.tsx` | Settings draft registry. `SettingsDraftProvider` + `useSettingsDraftSource({id,page,isDirty,commit,reset})`. → see `settings-draft-context.tsx.AGENTS.md` |
| `shell-sessions-context.tsx` | React context exposing shell's `ReadonlyMap<string,DashboardSession>` to plugin claims. → see `shell-sessions-context.tsx.AGENTS.md` |
| `slot-consumers.tsx` | One component per slot id: `SidebarFolderSectionSlot`, `SessionCardBadgeSlot`, `SessionCardActionBarSlot`,… → see `slot-consumers.tsx.AGENTS.md` |
| `SlotPill.tsx` | Shared single-concern directory-card slot pill. Exports `SlotPill`, `SlotPillProps`, `SlotAccent`,… → see `SlotPill.tsx.AGENTS.md` |
| `folder-project.ts` | Client folder-project cache. `useFolderProject`, `getFolderProject`, `invalidateFolderProject`,… → see `folder-project.ts.AGENTS.md` |
| `slot-error-boundary.tsx` | Per-claim React error boundary. Logs `[slot-error-boundary] Plugin "<id>" slot "<slot>" threw:` + renders nothing for failing claim without suppressing siblings. |
| `slot-registry.ts` | `createSlotRegistry()` — typed `Map<SlotId, ClaimEntry[]>` pre-sorted by `(priority, pluginId)`. → see `slot-registry.ts.AGENTS.md` |
| `ui-primitive-context.tsx` | React context provider + lookup hooks for UI primitives. Exports `UiPrimitiveProvider`,… → see `ui-primitive-context.tsx.AGENTS.md` |
| `ui-primitive-registry.ts` | Runtime data structure for UI primitives. Exports `UiPrimitiveRegistry` (opaque, private `_impls` map),… → see `ui-primitive-registry.ts.AGENTS.md` |
