## 1. Shared resolver seam

- [ ] 1.1 Identify the pure subset of `pi-resource-scanner.resolvePackagePath` (npm/git/abs/relative). Decide between (a) extract to `packages/shared/` or (b) inject as a function parameter into `discoverPlugins`. Prefer injection to keep `dashboard-plugin-runtime` framework-agnostic.
- [ ] 1.2 If injection: add an optional `resolvePackagePath?: (entry, settingsDir, scope, cwd?) => { resolved, source } | null` parameter to `discoverPlugins(opts)`; default is the workspace-only behaviour.
- [ ] 1.3 If extraction: move pure resolver to `packages/shared/src/pi-package-resolve.ts` and update `pi-resource-scanner.ts` to import from there; add unit tests covering each scheme.
- [ ] 1.4 Add a thin wrapper `loadGlobalPiPackages()` in `packages/server/src/` that reads `~/.pi/agent/settings.json#packages[]` (atomic read, returns `[]` on missing/invalid file).

## 2. `discoverPlugins()` extension

- [ ] 2.1 Extend `packages/dashboard-plugin-runtime/src/server/loader.ts:discoverPlugins()` to also iterate the entries returned by `loadGlobalPiPackages()`, resolve each via the shared resolver, and check for `pi-dashboard-plugin` (or adjacent `dashboard-plugin.json`).
- [ ] 2.2 Add deduplication: when the same plugin id appears in workspace + global, the workspace entry wins; emit a `warn` log naming both source paths.
- [ ] 2.3 Track `source: "workspace" | "global"` on every `DiscoveredPlugin` and propagate to `PluginStatus`.
- [ ] 2.4 Tag the shadowed (pi-installed) entry with `loaded: false` and `error: "Shadowed by workspace plugin of the same id."` in `PluginStatusStore`.
- [ ] 2.5 Add `clearDiscoveryCache()` exported from `@blackbelt-technology/dashboard-plugin-runtime/server` that nulls `_discoveryCache` and any per-cwd memoization. Add tests asserting subsequent `discoverPlugins()` calls re-execute the scan.
- [ ] 2.6 Unit-test discovery for: npm-resolved plugin, git-resolved plugin, abs-path plugin, missing-target package (warn + skip), pi-extension-without-manifest (silent skip), workspace-shadows-global, deterministic ordering.

## 3. Local-scope detection (warning surface only)

- [ ] 3.1 Add `discoverLocalDetectedPlugins(cwds: string[])` helper that iterates each cwd, reads `<cwd>/.pi/settings.json#packages[]`, and returns `LocalDetectedPlugin[]` with `{ id, displayName, claims, cwd }` for any package declaring a `pi-dashboard-plugin` manifest.
- [ ] 3.2 Wire it into the plugin-status pipeline: server bootstrap and post-install discovery passes the set of active session cwds (from `sessionManager` / `directoryService`) into the helper, and merges the result into `PluginStatusStore` with `source: "local-detected", loaded: false, enabled: false, error: "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable."`.
- [ ] 3.3 Ensure local-detected entries are NOT loaded as server entries, do NOT register bridges, and do NOT contribute claims to the slot registry.
- [ ] 3.4 Add unit tests: local-only install produces warning entry; same plugin installed both globally and locally produces one `loaded: true` global entry plus one `local-detected` warning entry.

## 4. `PluginStatus` schema + broadcast

- [ ] 4.1 Extend `PluginStatus` in `packages/shared/src/dashboard-plugin/plugin-status.ts` with `source: "workspace" | "global" | "local-detected"` and `restartRequired?: boolean` (additive).
- [ ] 4.2 Add `plugins_changed { plugins: PluginStatus[] }` to the browser-protocol union in `packages/shared/src/browser-protocol.ts`.
- [ ] 4.3 Implement `PluginStatusStore.broadcast()` (or equivalent) that emits the current snapshot via the existing `browserGateway.broadcast`. Wire it into `setStatus` so any status mutation triggers the broadcast.
- [ ] 4.4 Add a server-side helper `recomputeAndBroadcastPlugins({ activeCwds })` that performs: `clearDiscoveryCache()` → `discoverPlugins()` → `loadServerEntries()` → `discoverLocalDetectedPlugins()` → `broadcast()`.

## 5. Package-routes integration

- [ ] 5.1 In `packages/server/src/routes/package-routes.ts`, add a hook in the success branch of `install`, `remove`, and `update` for `scope: "global"` that invokes `recomputeAndBroadcastPlugins({ activeCwds })`.
- [ ] 5.2 For `update` of an id already present in the previous discovery snapshot, mark `restartRequired: true` on the post-update entry.
- [ ] 5.3 For `scope: "local"` operations, do NOT invoke recompute. (Local detection updates happen on session creation/destruction, not on package mutation.)
- [ ] 5.4 Add integration tests: install of a plugin manifest produces a `plugins_changed` broadcast with the new entry; install of a non-plugin package produces a broadcast with unchanged snapshot; remove works symmetrically; failed install does not broadcast.

## 6. Local-detection lifecycle hooks

- [ ] 6.1 Identify the canonical event(s) for "session created with cwd X" and "session ended for cwd X" — likely `sessionManager` register/unregister.
- [ ] 6.2 On session create, run `discoverLocalDetectedPlugins([cwd])` for the new cwd only (incremental) and merge into status; broadcast `plugins_changed` if anything changed.
- [ ] 6.3 On session end, recompute the union of active cwds and prune any `local-detected` entries whose cwd no longer has a live session.
- [ ] 6.4 Add tests: spawning a session with a local-installed plugin manifest surfaces a warning; ending that session removes the warning.

## 7. Client-side `<PluginsSection>`

- [ ] 7.1 Add `usePluginsStatus()` hook in `packages/client/src/hooks/`: subscribes to `plugins_changed` over the existing browser WS, fetches initial state via `/api/health`, returns `{ plugins, isLoading }`.
- [ ] 7.2 Add `<PluginsSection>` component under `packages/client/src/components/SettingsPanel/PluginsSection.tsx`. Renders a table of plugins with: name, status badge, claim count, error text, restart-required hint, enable/disable toggle.
- [ ] 7.3 Wire the toggle to the existing plugin-config write endpoint (`POST /api/config/plugins/:id`) writing `{ enabled: bool }`.
- [ ] 7.4 Status badge styles: green `loaded`, red `failed`, grey `disabled`, amber `local-detected`. Use existing tailwind tokens.
- [ ] 7.5 Empty-state copy: "No plugins installed." with a 1-line link to README plugin docs.
- [ ] 7.6 Mount `<PluginsSection>` inside the General tab of `SettingsPanel.tsx`, after the existing Tools section.
- [ ] 7.7 Component tests (vitest + RTL): healthy plugin row, failed plugin shows error, local-detected shows warning, toggle dispatches POST and re-renders, empty state.

## 8. Optional npm-search keyword

- [ ] 8.1 In `packages/server/src/npm-search-proxy.ts`, accept `pi-dashboard-plugin` alongside `pi-package` as the keyword filter (additive — both keywords are searched).
- [ ] 8.2 Test: a package keywords:`["pi-dashboard-plugin"]` appears in the existing package browser.

## 9. Documentation

- [ ] 9.1 Update `README.md` with a "Plugins" section: how to install (`pi install npm:<id>`), trust model warning ("plugins execute arbitrary code with the same trust as pi extensions"), where status surfaces in the UI, and the local-scope limitation.
- [ ] 9.2 Add a `docs/plugin-architecture.md` cross-reference or update the existing one with the new discovery contract and `source` field.
- [ ] 9.3 Add file-index rows for all new files under the matching split (`docs/file-index-server.md`, `docs/file-index-client.md`, `docs/file-index-shared.md`) per AGENTS.md docs-update protocol — delegate the docs/ writes to a general-purpose subagent in caveman style.
- [ ] 9.4 Add an FAQ entry to `docs/faq.md` for "I installed a plugin and nothing happened" / "Plugin shows local-detected warning" / "Plugin says restart required".

## 10. End-to-end verification

- [ ] 10.1 Manual smoke test: install `@blackbelt-technology/pi-dashboard-subagents` (or a fixture with a plugin manifest) globally; verify the new `<PluginsSection>` shows the plugin within ~1s of the install completing, no server restart required.
- [ ] 10.2 Manual smoke test: install the same package locally in a session cwd; verify the local-detected warning appears with actionable copy.
- [ ] 10.3 Manual smoke test: uninstall globally; verify the section updates and the plugin disappears.
- [ ] 10.4 Manual smoke test: simulate a failing plugin (throw in server entry); verify red badge + error text in the UI.
- [ ] 10.5 Run `npm test` and ensure all unit + integration tests added in steps 2/3/5/6/7 pass.
- [ ] 10.6 Run `openspec validate external-dashboard-plugins --strict` and resolve any issues.
