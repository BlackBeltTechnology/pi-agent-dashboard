# DOX — packages/dashboard-plugin-runtime/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `app-mount.ts` | `ctx.serveApp` engine. `mountApp(env,opts)` validates (`appId` `^[a-z0-9-]+$` default plugin id + unique,… → see `app-mount.ts.AGENTS.md` |
| `build-declaration-sdk.ts` | `computeBuildDeclaration(plugins, {isProd, bundleRoots})` — builds the served-artifact declaration from an… → see `build-declaration-sdk.ts.AGENTS.md` |
| `build-metadata.ts` | Build-declaration shape + IO. `BUILD_DECLARATION_FILENAME` (`pi-dashboard-build.json`),… → see `build-metadata.ts.AGENTS.md` |
| `client-content-hash.ts` | `createContentHasher({digestFile?})` → `{hashDir(dir), clear(), digestCalls}`. → see `client-content-hash.ts.AGENTS.md` |
| `client-layout.ts` | `evaluateClientLayout({packageDir, clientBundle, clientStyles, server, bridge})` → `{clientBundlePath,… → see `client-layout.ts.AGENTS.md` |
| `client-registry-set.ts` | `selectClientRegistryPlugins(discovered, {isProd, bundleRoots})` — the ONE client-registry plugin-set… → see `client-registry-set.ts.AGENTS.md` |
| `config-redact.ts` | `redactWriteOnly(config, schema)` — strips every `writeOnly:true` property, recursing `properties` +… → see `config-redact.ts.AGENTS.md` |
| `config-validator.ts` | `validatePluginConfig`, `applySchemaDefaults` — Ajv JSON-Schema 7 validation for plugin config writes. |
| `confined-static.ts` | Realpath-confined static helpers extracted from `app-mount.ts` (no behaviour change): `STATIC_MIME` (app… → see `confined-static.ts.AGENTS.md` |
| `file-validator-pool.ts` | `createFileValidatorPool({size=2,queueMax=8,timeoutMs=5000})` / `getFileValidatorPool()`. → see `file-validator-pool.ts.AGENTS.md` |
| `file-validator-registry.ts` | `FileValidatorRegistry` singleton `getFileValidatorRegistry()` keyed `(pluginId, claimId)`;… → see `file-validator-registry.ts.AGENTS.md` |
| `file-validator-worker.mjs` | Plain-ESM worker entry: imports validator module, runs `validate(bytes, ext)`, hashes bytes before/after, transfers bytes back. See change: add-editor-pane-file-handlers. |
| `first-party.ts` | First-party plugin identity = npm scope `@blackbelt-technology/` (`FIRST_PARTY_PLUGIN_SCOPE`). → see `first-party.ts.AGENTS.md` |
| `fixture-gate.ts` | `FIXTURE_PLUGINS_ENV` (`PI_DASHBOARD_FIXTURE_PLUGINS`), `fixturePluginsEnabled(env?)` (exactly `"1"`),… → see `fixture-gate.ts.AGENTS.md` |
| `index.ts` | Server-side barrel for `@blackbelt-technology/dashboard-plugin-runtime/server`. → see `index.ts.AGENTS.md` |
| `installed-probe.ts` | `createIsPiExtensionInstalled({listGlobal, listLocal, now?, ttlMs?})` — host factory for the… → see `installed-probe.ts.AGENTS.md` |
| `loader.ts` | `discoverPlugins(repoRoot?, extraSearchDirs?, opts?)` (cache keyed by effective root set + `bundledPluginIds`… → see `loader.ts.AGENTS.md` |
| `local-scope-detector.ts` | `createLocalScopeDetector({listCwds, listProjectPackageDirs?})` → `{rerun(): boolean}`: project-scope… → see `local-scope-detector.ts.AGENTS.md` |
| `host-api-gate.ts` | Pure `evaluateHostApi({source, range, hasClientBundle})` → `{status, refuse, warn, reason}`. → see `host-api-gate.ts.AGENTS.md` |
| `loopback-callback.ts` | `createLoopbackCallback({path='/callback',timeoutMs=300_000,signal,successHtml})` →… → see `loopback-callback.ts.AGENTS.md` |
| `plugin-enabled.ts` | `resolvePluginEnabled(configValue, defaultEnabled)` — explicit boolean `enabled` in config wins → manifest… → see `plugin-enabled.ts.AGENTS.md` |
| `plugin-refresh.ts` | `createPluginRefresher({loadDeps, readDeclaredBundledIds?, clearContentHashCache?, localDetector?,… → see `plugin-refresh.ts.AGENTS.md` |
| `plugin-status-store.ts` | In-memory `PluginStatusStore` for `/api/health.plugins[]`. `removeStatus(id)` drops a row. → see `plugin-status-store.ts.AGENTS.md` |
| `requirement-probes.ts` | Declarative requirement probes for `PluginManifest.requires`. → see `requirement-probes.ts.AGENTS.md` |
| `runtime-client-registry.ts` | `createRuntimeClientRegistry(deps)` → `{resolveClient(status), getAdmittedRuntimePlugins(),… → see `runtime-client-registry.ts.AGENTS.md` |
| `server-context.ts` | `createServerPluginContext(deps, pluginId)` factory — creates `ServerPluginContext` scoped to plugin with… → see `server-context.ts.AGENTS.md` |
| `ws-route-registry.ts` | Plugin-owned WS route scopes (add-browser-relay D1). `WsRouteRegistry` + singleton `getWsRouteRegistry()`… → see `ws-route-registry.ts.AGENTS.md` |
