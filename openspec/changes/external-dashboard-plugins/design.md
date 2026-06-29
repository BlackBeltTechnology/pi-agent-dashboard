## Context

The dashboard plugin runtime (`dashboard-plugin-architecture`, `dashboard-plugin-loader`) shipped expecting all plugins to live as workspace packages under `<dashboard-cwd>/packages/*`. That works for first-party plugins like `demo-plugin`, but blocks third-party plugins from shipping. Two real plugins want to land:

1. **Companion settings screen** for `@blackbelt-technology/pi-dashboard-subagents`. The extension already works in TUI + dashboard via generic rendering, but its 7-step `ctx.ui.input` setup wizard is hostile and there is no native control over the plugin's own config. A `settings-section` claim in the plugin runtime solves this in ~150 LOC of plugin code.

2. **OpenSpec plugin variants / future community plugins** that may ship out-of-tree.

Pi already has a package manager (`DefaultPackageManager` wrapped by `package-manager-wrapper.ts`) that installs packages to one of three locations resolvable via `pi-resource-scanner.resolvePackagePath()`:

- `npm:<name>` → `$(npm root -g)/<name>`
- `git:<url>` / `https://...` → `~/.pi/agent/git/<host>/<path>`
- absolute / relative path → as-is / relative to settings dir

Installed packages are recorded in `~/.pi/agent/settings.json#packages[]` (global) or `<cwd>/.pi/settings.json#packages[]` (local). The dashboard's `discoverPlugins()` does not consult either — it only globs its own monorepo. Closing that gap is the primary fix.

A second concern is failure visibility. `getPluginStatusStore()` already produces `{ id, enabled, loaded, error?, claims }` and `/api/health.plugins[]` exposes it. No client component renders that data, so a failing plugin disappears silently. Without a Plugins UI surface, encouraging third-party plugins increases the silent-failure surface area unacceptably.

## Goals / Non-Goals

**Goals:**

- A user running `pi install npm:<plugin>` (or any other pi-installer source) SHALL see the plugin's claims rendered by the dashboard without manual symlinks, dashboard rebuilds, or config edits.
- The plugin discovery rule SHALL reuse existing pi resolver logic (`resolvePackagePath`); no parallel resolution code.
- Plugin failures SHALL be visible in the Settings UI (status, error text, claim count, enable/disable toggle).
- A plugin install / remove / update SHALL invalidate the discovery cache and propagate status to all open browsers; process restart SHALL NOT be required.
- Local-scope (per-cwd) plugin installs SHALL be detected and surfaced as a documented warning ("local-scope plugins not supported in this release"), not silently ignored.

**Non-Goals:**

- **Local-scope plugin loading** (Phase 2). Per-cwd plugins demand scope-aware slot semantics and a "Project Settings" UI surface — out of scope here.
- **Plugin allowlist / sandbox / permission system.** Plugins remain trusted code, same as pi extensions. README documents the trust model.
- **Hot-reload of an already-loaded plugin's code.** Install adds new plugins; updating an existing plugin's code still requires server restart in this change. (The pi-bridge auto-register path works without restart; the dashboard React registry does not.)
- **A new public plugin registry / marketplace.** Optional npm-search keyword filter is the only discoverability change.

## Decisions

### Decision 1: Reuse `pi-resource-scanner.resolvePackagePath` rather than inventing a parallel resolver

`pi-resource-scanner.ts:193` already maps `npm:` / `git:` / `https://` / absolute / relative entries to filesystem locations. `discoverPlugins()` SHALL import that resolver and apply it to every entry in `~/.pi/agent/settings.json#packages[]`, then look for `pi-dashboard-plugin` in the resolved package's `package.json` (or adjacent `dashboard-plugin.json`).

**Alternative considered**: scanning `node_modules` directly via npm conventions. Rejected — pi may install via git, abs path, or local-path sources. The settings file is the canonical "what's installed" registry; using it keeps the dashboard's view of installed packages aligned with pi's view at all times.

### Decision 2: Phase 1 is global-scope-only with explicit local-scope warning

The dashboard SHALL scan `~/.pi/agent/settings.json#packages[]`. It SHALL NOT scan per-cwd `<cwd>/.pi/settings.json#packages[]` for plugin loading purposes.

However, the discovery routine SHALL inspect known active sessions' cwds and emit a warning entry (`source: "local-detected"`) for any local-installed plugin manifest found. This entry SHALL appear in `/api/health.plugins[]` with `loaded: false, error: "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable."` so users get a clear path forward.

**Alternatives considered**:
- *Full scope-aware loading (Design B from exploration)* — defers because slot semantics differ between global slots (settings-section, management-modal, toast) and session slots (everything else). Premature without a driving use-case.
- *Silent ignore* — bad UX. Users who install locally should learn why nothing rendered.

The forward path to Phase 2 is documented in **Open Questions**.

### Decision 3: Cache invalidation hooks live in `package-routes.ts`, status broadcast reuses existing channel

After successful `/api/packages/install`, `/api/packages/remove`, or `/api/packages/update` against `scope: "global"`, the route handler SHALL:

1. Call a new `clearDiscoveryCache()` helper exported from `dashboard-plugin-runtime/server`.
2. Re-run `discoverPlugins()` and `loadServerEntries()` to register newly added plugins.
3. Update the `PluginStatusStore` for all currently-discovered plugins.
4. Broadcast `plugin_config_update` (existing event) — or a new `plugins_changed` event — to all subscribed browsers so `usePluginConfig`-style hooks and the new `<PluginsSection>` re-fetch.

**Alternative considered**: full server restart on plugin install. Rejected — too disruptive, breaks active sessions.

The lighter-weight path (re-discover + re-load entries) only adds plugins; it does NOT hot-swap an existing plugin's code (the React registry is built at Vite time). Removing or updating an existing plugin requires server restart. The UI SHALL surface this constraint with a "restart required" hint on the affected plugin row.

### Decision 4: Use a new `plugins_changed` broadcast rather than overload `plugin_config_update`

`plugin_config_update { id, config }` is a per-plugin config payload. A new event `plugins_changed { plugins: PluginStatus[] }` is added so clients can refresh the plugin list without subscribing to every plugin's config. This event piggybacks on the existing browser-protocol union. The new client hook `usePluginsStatus()` consumes it.

**Alternative considered**: have clients poll `/api/health` every N seconds. Rejected — stale UI, more traffic, breaks the existing reactive model.

### Decision 5: PluginsSection lives under Settings → General, mirroring ToolsSection

The new `<PluginsSection>` SHALL live in the existing General settings tab so users find plugin management next to other dashboard configuration. Each row SHALL show `{ id, displayName, status badge, claim count, error text, enable/disable toggle, "restart required" hint when applicable }`.

**Alternative considered**: a new top-level "Plugins" tab. Rejected — too few plugins today to justify; can promote later.

### Decision 6: Discovery scan order and conflict resolution

When the same plugin id appears in both `<dashboard-cwd>/packages/*` (workspace) and `~/.pi/agent/settings.json#packages[]` (pi-installed):

- The workspace-local plugin SHALL win.
- A conflict SHALL be logged at `warn` level: `[plugin-loader] Plugin "<id>" exists in both workspace and pi-install; using workspace version.`
- The pi-installed plugin SHALL appear in `/api/health.plugins[]` with `loaded: false, error: "Shadowed by workspace plugin of the same id."`

This matches existing semantics in `registerPluginBridge` (path-conflict detection in `plugin-bridge-register.ts`).

### Decision 7: Trust model is unchanged and explicit

Plugins execute arbitrary React + Node code with the trust level of any pi extension. No allowlist, no sandbox in this change. README and the Plugins settings panel SHALL state this explicitly. The dashboard does not gate which plugin packages a user can install — `pi install` is the trust boundary, just as it is for pi extensions today.

## Risks / Trade-offs

- **[Risk]** Discovery cache invalidation has subtle ordering: a plugin install must complete BEFORE `loadServerEntries()` re-runs, otherwise the new entry's server module is missing. **Mitigation**: invalidation hook fires from inside the package operation's success branch, after pi's `installAndPersist` resolves; existing single-flight constraint in `package-install` already serializes operations.

- **[Risk]** A newly installed plugin's `bridge` entry is auto-written to `~/.pi/agent/settings.json#dashboardPluginBridges`, but **active pi sessions don't reload extensions**. **Mitigation**: the existing `session-reload-on-package-change` capability already handles this for pi extension installs; we route plugin-bridge installs through the same prompt-to-reload flow. Document in PluginsSection: "Active sessions need a reload to pick up new bridge code."

- **[Risk]** `pi-resource-scanner.resolvePackagePath` lives in `packages/server/src/`. Importing it from `packages/dashboard-plugin-runtime/src/server/loader.ts` adds a runtime dependency between two packages. **Mitigation**: extract the pure resolution logic into a tiny shared module in `packages/shared/` (no I/O — just path math + npm-root probe), or expose an injection seam (`discoverPlugins({ resolvePackagePath })`). Prefer the latter to keep `dashboard-plugin-runtime` framework-agnostic.

- **[Trade-off]** Installing a plugin gives you React-component-level access to the dashboard. There is no permission model. This is the same trust as pi extensions; the README MUST state it. We accept this — gating community plugins behind a review process is a future concern.

- **[Trade-off]** Phase 1 leaves "local plugins" as a documented warning. Users with project-specific plugins must install globally for now. Acceptable because (a) no driving local-plugin use-case exists, (b) the warning is actionable, and (c) Phase 2 is additive.

- **[Risk]** `pi-resource-scanner.getNpmGlobalRoot()` shells out to `npm root -g`. On a fresh install with no npm cache this can be slow (1–3s). **Mitigation**: existing module-level cache (`cachedNpmGlobalRoot`); discovery already runs at startup so cost is paid once.

## Migration Plan

This change is **additive and backwards-compatible**:

- Existing first-party plugins under `packages/*` continue to work unchanged.
- `/api/health.plugins[]` schema gains a `source` field (additive) — older clients ignoring it still parse correctly.
- The new `plugins_changed` broadcast is a new message type; older clients ignore unknown types.
- Local-scope warnings are net-new; no migration of existing data.

**Rollback**: revert is safe. Removing the global-settings scan returns to monorepo-only discovery; no persistent state to clean up. The new UI section can be feature-flagged via a config key (`plugins.uiSection.enabled`) if a staged rollout is preferred — judgment call at implementation time.

## Open Questions

1. **Local-scope plugin loading (Phase 2 design).** When a real local-plugin use-case appears, the open decisions are:
   - Should `settings-section` claims from local plugins surface in a per-session "Project Settings" drawer (Design C from exploration), or be rejected outright?
   - Cache invalidation for local plugins must hook into session creation/destruction, not just package operations. New mechanism needed.
   - Same-id collision rules across global + local + workspace need a third tie-break level.

2. **Plugin update semantics.** This change handles install (additive). For an existing plugin's code being updated:
   - The pi-bridge entry can hot-reload via the existing pi-extension reload prompt.
   - The React client bundle CANNOT hot-reload (registry is build-time). Server restart required.
   - Should `<PluginsSection>` expose an "update" button that auto-restarts the dashboard? (Probably yes, but design + UX out of scope for Phase 1.)

3. **`npm-search-proxy` keyword.** Adding `pi-dashboard-plugin` to the keyword filter is trivial but couples discovery UX to npm. Consider whether plugins should also list themselves under `pi-package` for unified browse, or whether a dedicated "Plugins" tab in the package browser is warranted.

4. **Cache invalidation race**: if two install operations land within ms of each other (already gated by single-flight in `package-install`), is one cache rebuild enough? Probably yes — single-flight serializes — but worth a test.
