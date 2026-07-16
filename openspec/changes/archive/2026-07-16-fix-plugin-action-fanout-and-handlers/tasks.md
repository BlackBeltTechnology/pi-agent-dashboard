## 1. Root-cause & guardrails

- [x] 1.1 Confirm the last-writer-wins path end-to-end: `registerBrowserHandler("plugin_action")` → `browserGateway.registerHandler` → `customHandlers.set("plugin_action", …)` overwrites on `(priority asc, id asc)` load order (systematic-debugging).
- [x] 1.2 Verify no core custom handler (`watch_files`, `worktree_init_subscribe`) uses `pluginId`, so the fan-out branch must not disturb the `customHandlers` path.

## 2. Fan-out registry in the gateway

- [x] 2.1 Add failing test: two handlers registered under distinct pluginIds are both reachable; registering the second does not shadow the first (`packages/server/src/__tests__/`).
- [x] 2.2 Add failing test: a `plugin_action` with an unregistered `pluginId` produces a `plugin_action_error` to the sender and does NOT fall through to pi-gateway forward.
- [x] 2.3 Add `plugin_action_error` message to the shared protocol types (`src/shared` / `packages/shared`): `{ type, pluginId, action, error }`.
- [x] 2.4 Add `pluginActionHandlers = Map<pluginId, Handler>` + `registerPluginActionHandler(pluginId, handler)` to `browser-gateway.ts`; leave `registerHandler`/`customHandlers` untouched.
- [x] 2.5 In the dispatch default case, branch on `type === "plugin_action"`: look up `pluginActionHandlers.get(msg.pluginId)`; on miss, `sendTo(ws, plugin_action_error)` and log; never silent-drop.
- [x] 2.6 Warn on duplicate pluginId registration instead of silently replacing.
- [x] 2.7 Verify 2.1–2.2 pass and the existing register-handler test stays green.

## 3. Host wiring (pluginId from manifest)

- [x] 3.1 In `server.ts` `createContext: (plugin) => …`, route the `registerBrowserHandler` wrapper: `type === "plugin_action"` → `registerPluginActionHandler(plugin.manifest.id, wrapped)`, else `registerHandler(type, wrapped)` (doubt-driven-review before this cross-cutting change stands).
- [x] 3.2 Confirm no `ServerPluginContext` signature change — plugins still call `registerBrowserHandler("plugin_action", handler)` unchanged.

## 4. Real per-plugin handlers

- [x] 4.1 flows: replace the logged stub — `flow.run` dispatches a `flow:run` event into the run session via the existing flows action path; `flow.new` scaffolds; keep the `pluginId !== PLUGIN_ID` guard (security-hardening: validate `sessionId`/payload).
- [x] 4.2 kb: register a `plugin_action` handler — `reindex` → `registry.start(cwd, () => reindexAll(cwd))`; config mutation → the load/patch/persist the PUT route runs; validate `cwd` against known cwds (security-hardening).
- [x] 4.3 automation: register a `plugin_action` handler — `create`/`run`/`stop` → `hooks.runNow` / `hooks.stopRun` / create logic; enforce the same required fields as routes (`name`, `runId`) (security-hardening).
- [x] 4.4 Add a scenario test per plugin: `flow.run` invokes the run path (not a stub); kb reindex and automation run reach their cores and return a result.

## 5. Bus-client allow-list

- [x] 5.1 Extend `KNOWN_PLUGIN_HANDLERS` in `packages/bus-client/src/client.ts` to `["goal","flows","kb","automation"]`; update the JSDoc that references the goal-only limitation.

## 6. Verify & land

- [x] 6.1 Contract test (spec `dashboard-plugin-loader`): both plugins reachable regardless of load order; unknown pluginId → structured error; core custom handlers still dispatch.
- [x] 6.2 `npm test` green; type-check clean.
- [x] 6.3 Rebuild per matrix: server change → restart; plugin/extension changes → reload. Manual smoke: drive `plugin("flows"|"kb"|"automation", …)` over the bus and confirm the core executes.
- [x] 6.4 Update per-file `AGENTS.md` rows for `browser-gateway.ts`, `server.ts`, the three plugin `index.ts`, and `bus-client/client.ts` with `See change: fix-plugin-action-fanout-and-handlers`.
