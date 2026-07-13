## Context

The dashboard plugin runtime (`dashboard-plugin-architecture`, `dashboard-plugin-loader`) shipped expecting all plugins to live as workspace packages under `<dashboard-cwd>/packages/*`. That works for first-party plugins like `demo-plugin`, but blocks third-party plugins from shipping. Two real plugins want to land:

1. **Companion settings screen** for `@blackbelt-technology/pi-dashboard-subagents`. The extension already works in TUI + dashboard via generic rendering, but its 7-step `ctx.ui.input` setup wizard is hostile and there is no native control over the plugin's own config. A `settings-section` claim in the plugin runtime solves this in ~150 LOC of plugin code.

2. **OpenSpec plugin variants / future community plugins** that may ship out-of-tree.

Pi already has a package manager (`DefaultPackageManager` wrapped by `package-manager-wrapper.ts`) that installs packages to one of three locations resolvable via `pi-resource-scanner.resolvePackagePath()`:

- `npm:<name>` → `$(npm root -g)/<name>`
- `git:<url>` / `https://...` → `~/.pi/agent/git/<host>/<path>`
- absolute / relative path → as-is / relative to settings dir

Installed packages are recorded in `~/.pi/agent/settings.json#packages[]` (global) or `<cwd>/.pi/settings.json#packages[]` (local).

### Current state (shipped, diverged from proposal)

The dashboard's `discoverPlugins()` does NOT consult `settings.json#packages[]`. It scans three hardcoded directories: workspace `<monorepo>/packages/*/`, user-installed `~/.pi/dashboard/plugins/`, and bundled `resources/plugins/` — in priority order (workspace > user-installed > bundled), dedup by plugin id. This architecture shipped as part of `add-plugin-activation-ui` using `findInstalledPluginsDir()` and `findBundledPluginsDir()` helpers. `clearDiscoveryCache()` exists but has no caller.

The primary gap — integrating the pi-package-resolver seam (`pi-resource-scanner.resolvePackagePath()`) to scan `settings.json#packages[]` entries — remains unimplemented.

Failure visibility: `getPluginStatusStore()` produces `{ id, enabled, loaded, error?, claims }` and `/api/health.plugins[]` exposes it. The `<PluginsSection>` client component (shipped via `add-plugin-activation-ui`) renders this data in Settings → General with status pills, toggles, error display, dependency graph, and missing-requirements inline install.

## Goals / Non-Goals

**Goals (status after drift reconciliation — 2026-07-13):**

- ~~A user running `pi install npm:<plugin>` SHALL see the plugin's claims without manual steps.~~ **NOT IMPLEMENTED** — `discoverPlugins()` does not scan `settings.json#packages[]`. Shipped discovery uses `~/.pi/dashboard/plugins/` which requires a separate install mechanism.
- ~~The plugin discovery rule SHALL reuse existing pi resolver logic (`resolvePackagePath`).~~ **NOT IMPLEMENTED** — shipped discovery uses hardcoded directory scan via `findInstalledPluginsDir()`/`findBundledPluginsDir()`.
- ✅ Plugin failures SHALL be visible in the Settings UI. **COMPLETE** — `<PluginsSection>` shipped via `add-plugin-activation-ui` renders status, error text, claims, and enable/disable toggle.
- ~~A plugin install / remove / update SHALL invalidate the discovery cache and propagate status without restart.~~ **PARTIALLY IMPLEMENTED** — `clearDiscoveryCache()` exists but has no caller; no broadcast mechanism wires it to package operations.
- ~~Local-scope (per-cwd) plugin installs SHALL be detected and surfaced as a warning.~~ **NOT IMPLEMENTED** — no local-detection logic exists.

**Non-Goals:**

- **Local-scope plugin loading** (Phase 2). Per-cwd plugins demand scope-aware slot semantics and a "Project Settings" UI surface — out of scope here.
- **Plugin allowlist / sandbox / permission system.** Plugins remain trusted code, same as pi extensions. README documents the trust model.
- **Hot-reload of an already-loaded plugin's code.** Install adds new plugins; updating an existing plugin's code still requires server restart in this change. (The pi-bridge auto-register path works without restart; the dashboard React registry does not.)
- **A new public plugin registry / marketplace.** Optional npm-search keyword filter is the only discoverability change.

## Decisions

### Decision 1: Reuse `pi-resource-scanner.resolvePackagePath` rather than inventing a parallel resolver (**NOT IMPLEMENTED**)

**Shipped alternative**: `discoverPlugins()` uses `findInstalledPluginsDir()` (`~/.pi/dashboard/plugins/`) and `findBundledPluginsDir()` (`resources/plugins/`) — a direct-directory-scan approach, not `pi-resource-scanner.resolvePackagePath()`. This was shipped as part of `add-plugin-activation-ui`. The `settings.json#packages[]` scan envisioned here was never wired in.

**Still the right design**: `pi-resource-scanner.ts:193` already maps `npm:` / `git:` / `https://` / absolute / relative entries to filesystem locations. Closing the gap means wiring this resolver into `discoverPlugins()` as a 4th scan source, reusing the existing dedup logic (workspace > installed > bundled > global).

### Decision 2: Phase 1 is global-scope-only with explicit local-scope warning (**NOT IMPLEMENTED**)

Neither `~/.pi/agent/settings.json#packages[]` scanning nor local-detection exists in the shipped code. No `source: "global" | "local-detected"` field on any type. This section describes the intended design for the remaining implementation.

The forward path to Phase 2 is documented in **Open Questions**.

### Decision 3: Cache invalidation hooks live in `package-routes.ts`, status broadcast reuses existing channel (**PARTIALLY IMPLEMENTED**)

`clearDiscoveryCache()` exists in `@blackbelt-technology/dashboard-plugin-runtime/server` (shipped via `add-plugin-activation-ui`). However:
- No caller triggers it — no hooks in `package-routes.ts`.
- No `loadServerEntries()` re-run after package ops.
- No broadcast (of either `plugin_config_update` or new `plugins_changed`) after cache invalidation.

The design below remains valid for the remaining implementation:

After successful `/api/packages/install`, `/api/packages/remove`, or `/api/packages/update` against `scope: "global"`, the route handler SHALL:

1. Call `clearDiscoveryCache()` (already exists).
2. Re-run `discoverPlugins()` and `loadServerEntries()` to register newly added plugins.
3. Update the `PluginStatusStore` for all currently-discovered plugins.
4. Broadcast to all subscribed browsers.

The lighter-weight path (re-discover + re-load entries) only adds plugins; it does NOT hot-swap an existing plugin's code.

### Decision 4: Use a new `plugins_changed` broadcast rather than overload `plugin_config_update`

`plugin_config_update { id, config }` is a per-plugin config payload. A new event `plugins_changed { plugins: PluginStatus[] }` is added so clients can refresh the plugin list without subscribing to every plugin's config. This event piggybacks on the existing browser-protocol union. The new client hook `usePluginsStatus()` consumes it.

**Alternative considered**: have clients poll `/api/health` every N seconds. Rejected — stale UI, more traffic, breaks the existing reactive model.

### Decision 5: PluginsSection lives under Settings → General, mirroring ToolsSection

The new `<PluginsSection>` SHALL live in the existing General settings tab so users find plugin management next to other dashboard configuration. Each row SHALL show `{ id, displayName, status badge, claim count, error text, enable/disable toggle, "restart required" hint when applicable }`.

**Alternative considered**: a new top-level "Plugins" tab. Rejected — too few plugins today to justify; can promote later.

### Decision 6: Discovery scan order and conflict resolution (**ALREADY SHIPPED for 3-dir scan**)

The shipped `discoverPlugins()` scans 3 directories in priority order with dedup by plugin id:
1. Workspace `<monorepo>/packages/*/` (highest priority)
2. User-installed `~/.pi/dashboard/plugins/`
3. Bundled `resources/plugins/` (lowest priority)

When the same id appears in multiple directories, the earliest (highest-priority) version wins. The docstring notes: "Earlier search dirs win on ID collisions (monorepo > installed > bundled)."

The same principle extends to the unimplemented `settings.json#packages[]` (4th source, lowest priority): workspace > installed > bundled > global.

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

This change is **additive and backwards-compatible** — once implemented:

- Existing first-party plugins under `packages/*` continue to work unchanged.
- `/api/health.plugins[]` schema gains a `source` field (additive) — older clients ignoring it still parse correctly.
- The new `plugins_changed` broadcast is a new message type; older clients ignore unknown types.
- Local-scope warnings are net-new; no migration of existing data.

**Rollback**: revert is safe. Removing the global-settings scan returns to the shipped 3-dir discovery; no persistent state to clean up. The UI section (already shipped) is independent.

**Current migration concern**: the shipped `discoverPlugins()` uses `~/.pi/dashboard/plugins/` while the proposed `settings.json#packages[]` scan uses a different directory. To avoid confusion, the implementation should merge the two: a plugin installed via `pi install` and recorded in `settings.json#packages[]` SHALL be found by the new scanner; the `~/.pi/dashboard/plugins/` directory can remain as a legacy user-install path or be deprecated. Forward path documented in drift reconciliation (proposal.md).

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
