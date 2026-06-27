## 1. Protocol type (drop the `as never` casts)

- [x] 1.1 `browser-protocol.ts`: added `PluginConfigWriteBrowserMessage` + included in `BrowserToServerMessage`.
- [x] 1.2 Server browser-gateway compiles (message consumed client-side; no server handler).

## 2. Client interception → canonical route (the modular fix)

- [x] 2.1 `plugins-api.ts`: `writePluginConfig(id, config)` → `POST /api/config/plugins/:id`; throws route `{error}` on non-2xx. Plus `dispatchPluginMessage(msg, wsSend)` (testable routing helper).
- [x] 2.2 `App.tsx`: `send={(msg) => dispatchPluginMessage(msg, (m) => send(m))}` — generic by `id`, no per-plugin branching.
- [x] 2.3 `registerPluginConfigRoutes` mounted with broadcast dep (server.ts:1083); smoke POST returned 200 + broadcast path intact.

## 3. Awaitable commit (honor the draft contract)

- [x] 3.1 Widened plugin send to `(message: unknown) => void | Promise<void>` (context value `send`, `usePluginSend` return, provider `send` prop, internal `send` callback now returns `sendFn(message)`).
- [x] 3.2 `await send({...})` + dropped `as never` in `flows`, `automation`; dropped `as never` in `flows-anthropic-bridge` + `demo` (onClick saves, not draft commits). (`goal`/`roles` do not use `plugin_config_write` — grep-confirmed callers.)
- [x] 3.3 Reject-on-failure verified by `writePluginConfig` 400/409 reject tests; `commit()` awaits so a rejection keeps the draft dirty per the `SettingsDraftSource` contract (host shows partial-fail, not "Settings saved").

## 4. Tests

- [x] 4.1 `plugin-config-write.test.ts`: routing — config_write → REST (not WS), pass-through for other types, defensive no-id pass-through.
- [x] 4.2 `plugin-config-write.test.ts`: `writePluginConfig` resolves on 2xx, rejects with route error on 400 + 409 (mock fetch). 6 tests green.
- [x] 4.3 Route is pre-existing + unchanged; end-to-end smoke (5.3) confirms 200 + persist + merge. (No pre-existing route test harness; route logic untouched by this change.)
- [~] 4.4 Dirty-clear is platform behavior (`plugin_config_update` → `applyPluginConfigUpdate` → `usePluginConfig` re-render), unchanged here and covered by runtime plugin-context tests; reject-stays-dirty covered by 4.2 + the awaitable commit. No new component test added.

## 5. Validate + land

- [x] 5.1 `openspec validate --strict` → valid.
- [x] 5.2 Affected suites green (shared + dashboard-plugin-runtime + flows/automation): 1684 passed / 1 skipped; new plugin-config-write tests: 6 passed.
- [x] 5.3 `npm run build` clean; server restarted; smoke: `POST /api/config/plugins/flows {editFlow:true}` → HTTP 200, response merged `{enabled:true,editFlow:true}`, `config.json#plugins.flows.editFlow=true` (persisted, survives reload).
- [x] 5.4 Code-review gate run: CodeRabbit CLI absent (ENOENT) → deferred, exit 0 (advisory). 
- [x] 5.5 Docs: file-index-client row (writePluginConfig/dispatchPluginMessage) + file-index-shared row (plugin_config_write message). 

## 6. Reload hydration fix (read-back half)

- [x] 6.1 Root cause: `initPluginConfigs` defined but never called — client `pluginConfigs` Map never seeded on boot; reload reset every plugin's settings to schema defaults despite correct on-disk persistence.
- [x] 6.2 `App.tsx` boot `/api/config` fetch now calls `initPluginConfigs(d.data.plugins)` to seed the store from persisted config.
- [x] 6.3 `initPluginConfigs` (plugin-context.tsx) now uses `setConfig` so already-mounted `usePluginConfig` consumers are notified (fetch resolves post-render).
- [x] 6.4 Test: `plugin-context.test.tsx` "hydrates from initPluginConfigs and notifies already-mounted subscribers" (7 green).
- [x] 6.5 Verify live: GET /api/config returns flows config; built bundle contains seed call; server healthy after restart.
