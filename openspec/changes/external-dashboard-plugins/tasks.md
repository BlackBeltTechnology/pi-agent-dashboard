## 1. Shared resolver seam

- [ ] ~~1.1~~ **NOT IMPLEMENTED** — No resolver injection analysis done. The shipped `discoverPlugins()` uses hardcoded `findInstalledPluginsDir()` + `findBundledPluginsDir()` instead.
- [ ] ~~1.2~~ **NOT IMPLEMENTED** — No injection seam.
- [ ] ~~1.3~~ **NOT IMPLEMENTED** — No shared resolver extracted.
- [ ] ~~1.4~~ **NOT IMPLEMENTED** — Add a thin wrapper `loadGlobalPiPackages()` in `packages/server/src/` that reads `~/.pi/agent/settings.json#packages[]` (atomic read, returns `[]` on missing/invalid file).

## 2. `discoverPlugins()` extension

- [ ] ~~2.1~~ **NOT IMPLEMENTED** — Extend `discoverPlugins()` to scan `~/.pi/agent/settings.json#packages[]` entries. Shipped `discoverPlugins()` uses a different architecture (3 dirs: workspace, `~/.pi/dashboard/plugins/`, `resources/plugins/`). The gap: wire the settings.json scanning into the existing dedup logic.
- [ ] ~~2.2~~ **NOT IMPLEMENTED** — Dedup for settings.json entries vs existing 3 dirs. Current dedup (workspace > installed > bundled) needs to accommodate a 4th priority layer.
- [ ] ~~2.3~~ **NOT IMPLEMENTED** — No `source` field exists on `DiscoveredPlugin` or `PluginStatus` (`n` in `plugin-status.ts`). `plugin-status-store.ts` stores no source tracking.
- [ ] ~~2.4~~ **NOT IMPLEMENTED** — No shadowed-entry tagging for settings.json collisions.
- [ ] ~~2.5~~ **ALREADY SHIPPED** — `clearDiscoveryCache()` was shipped via `add-plugin-activation-ui`. Exported from `@blackbelt-technology/dashboard-plugin-runtime/server`. Tests exist. Re-scope: wire it into package-routes success hooks.
- [ ] ~~2.6~~ **NOT IMPLEMENTED** — Tests for the settings.json resolution path. Existing tests cover the 3-dir discovery.

## 3. Local-scope detection (warning surface only)

- [ ] ~~3.1~~ **NOT IMPLEMENTED** — No `discoverLocalDetectedPlugins()` exists.
- [ ] ~~3.2~~ **NOT IMPLEMENTED** — No wiring into plugin-status pipeline.
- [ ] ~~3.3~~ **NOT IMPLEMENTED** — No safety guards for local entries.
- [ ] ~~3.4~~ **NOT IMPLEMENTED** — No tests.

## 4. `PluginStatus` schema + broadcast

- [ ] ~~4.1~~ **NOT IMPLEMENTED** — Extend `PluginStatus` with `source` and `restartRequired`. The `PluginStatus` interface (`n` in `plugin-status.ts`) has no `source` field. `plugin-status-store.ts` tracks no source information.
- [ ] ~~4.2~~ **NOT IMPLEMENTED** — No `plugins_changed` in `browser-protocol.ts`. Only per-plugin `plugin_config_update` exists.
- [ ] ~~4.3~~ **NOT IMPLEMENTED** — `PluginStatusStore` has no `broadcast()` method. No WS emission on status mutation.
- [ ] ~~4.4~~ **NOT IMPLEMENTED** — No `recomputeAndBroadcastPlugins()` server-side helper.

## 5. Package-routes integration

- [ ] ~~5.1~~ **NOT IMPLEMENTED** — No cache-invalidation or broadcast hooks in `packages/server/src/routes/package-routes.ts`.
- [ ] ~~5.2~~ **NOT IMPLEMENTED** — No `restartRequired` tracking.
- [ ] ~~5.3~~ **NOT IMPLEMENTED** — No scope-aware gating.
- [ ] ~~5.4~~ **NOT IMPLEMENTED** — No integration tests.

## 6. Local-detection lifecycle hooks

- [ ] ~~6.1~~ **NOT IMPLEMENTED** — No event analysis done.
- [ ] ~~6.2~~ **NOT IMPLEMENTED** — No `discoverLocalDetectedPlugins()` exists.
- [ ] ~~6.3~~ **NOT IMPLEMENTED** — No prune logic.
- [ ] ~~6.4~~ **NOT IMPLEMENTED** — No tests.

## 7. Client-side `<PluginsSection>` — COMPLETE (shipped via `add-plugin-activation-ui`, 2026-05-16)

- ✅ 7.1 **COMPLETE** — Hook exists: component calls `listPlugins()` via `plugins-api.ts` + listens for `"plugin-config-update"` DOM events.
- ✅ 7.2 **COMPLETE** — `packages/client/src/components/PluginsSection.tsx` renders with status pills, toggle, error cards, missing-requirements inline install, dependency graph cascade dialog.
- ✅ 7.3 **COMPLETE** — Toggle calls `togglePlugin()` from `plugins-api.ts` which POSTs to `/api/config/plugins/:id`.
- ✅ 7.4 **COMPLETE** — Status badges use theme-aware CSS vars: green `enabled`, red `error`, grey `disabled`, amber `not loaded`.
- ✅ 7.5 **COMPLETE** — Empty state: "No plugins installed." with discoverability note.
- ✅ 7.6 **COMPLETE** — Mounted in Settings → General behind the Tools section.
- ✅ 7.7 **COMPLETE** — Component tests exist in the codebase.

## 8. Optional npm-search keyword

- [ ] ~~8.1~~ **NOT IMPLEMENTED** — `npm-search-proxy.ts` searches only `keywords:pi-package`. Does not accept `pi-dashboard-plugin`.
- [ ] ~~8.2~~ **NOT IMPLEMENTED** — No tests.

## 9. Documentation

- [ ] ~~9.1~~ **NOT IMPLEMENTED** — README not updated.
- [ ] ~~9.2~~ **NOT IMPLEMENTED** — No `docs/plugin-architecture.md` update.
- [ ] ~~9.3~~ **NOT IMPLEMENTED** — No file-index rows added.
- [ ] ~~9.4~~ **NOT IMPLEMENTED** — No FAQ entries.

## 10. End-to-end verification

- [ ] ~~10.1~~ **NOT IMPLEMENTED** — No global-install smoke test performed.
- [ ] ~~10.2~~ **NOT IMPLEMENTED** — No local-detection smoke test (no local-detection exists).
- [ ] ~~10.3~~ **NOT IMPLEMENTED** — No uninstall verification.
- [ ] ~~10.4~~ **NOT IMPLEMENTED** — No failure simulation.
- [ ] ~~10.5~~ **NOT IMPLEMENTED** — Tests from unimplemented tasks not run.
- [ ] ~~10.6~~ **NOT IMPLEMENTED** — Not validated.
