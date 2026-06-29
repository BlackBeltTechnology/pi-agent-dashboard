## Why

Dashboard plugins ship today only as workspace packages under `<dashboard-cwd>/packages/*`. Third-party plugins (e.g. a settings screen for the companion extension `@blackbelt-technology/pi-dashboard-subagents`) cannot reach the dashboard because `discoverPlugins()` does not scan pi-installed packages. Closing that gap lets `pi install npm:<plugin>` deliver both the pi extension and its dashboard plugin in a single step, using pi's existing installer — no parallel install system.

Two concrete use-cases driving this:
1. `@blackbelt-technology/pi-dashboard-subagents` wants a Settings → General section to edit the plugin's own config instead of a 7-step `ctx.ui.input` wizard.
2. The dashboard's Plugin status (`/api/health.plugins[]`) is server-side complete but invisible in the UI; failing plugins disappear silently.

## What Changes

- **Discovery**: `discoverPlugins()` SHALL also scan packages listed in `~/.pi/agent/settings.json#packages[]`, resolved via the existing `pi-resource-scanner.resolvePackagePath()` (npm / git / abs path / relative). Existing `<dashboard-cwd>/packages/*` discovery is preserved.
- **Scope**: Phase 1 is **global-scope only**. Plugins installed under a per-cwd `<cwd>/.pi/settings.json` SHALL be detected and surfaced as a "local-scope plugin not loaded" warning, but NOT loaded. Local-scope loading is explicitly deferred — see design.md "Deferred decisions".
- **Cache invalidation**: After a successful global-scope install / remove / update via `/api/packages`, the plugin discovery cache SHALL be cleared and `plugin_config_update` (or an equivalent broadcast) SHALL re-emit plugin status to all connected browsers. Process restart SHALL no longer be required to pick up newly installed plugins.
- **UI surface**: A new `<PluginsSection>` SHALL render in Settings → General, fetching `/api/health.plugins[]` and listing each plugin with status (`loaded` / `failed` / `disabled`), claim count, error text, and a per-plugin enable/disable control.
- **Discoverability (optional, low risk)**: `npm-search-proxy` keyword filter SHALL accept `pi-dashboard-plugin` alongside `pi-package` so plugins surface in the existing install browser.
- **Trust model**: Plugins execute arbitrary React + Node code with the same trust as any pi extension. README SHALL document this explicitly. No allowlist gating in this change.

## Capabilities

### New Capabilities

(none — this change extends existing capabilities only)

### Modified Capabilities

- `dashboard-plugin-loader`: discovery contract extended to read `~/.pi/agent/settings.json#packages[]`; cache invalidation contract added for post-install reload; local-scope detection + warning surface added.
- `package-install`: post-mutation hook MUST invalidate the plugin discovery cache and trigger plugin-status re-broadcast (no API surface change; behavioural addition).

## Impact

**Code**:
- `packages/dashboard-plugin-runtime/src/server/loader.ts` — extend `discoverPlugins()` with global-settings scan, share resolver with `pi-resource-scanner.ts`.
- `packages/server/src/routes/package-routes.ts` — invoke discovery-cache invalidation + status re-broadcast after install / remove / update.
- `packages/server/src/npm-search-proxy.ts` — accept additional keyword (optional).
- `packages/client/src/components/SettingsPanel.tsx` + new `PluginsSection.tsx` — UI surface for plugin status / errors / toggle.
- `packages/dashboard-plugin-runtime/src/server/plugin-status-store.ts` — add `source: "global" | "local-detected"` to status entries (so the UI can distinguish local-scope warnings from genuine failures).

**APIs**:
- `/api/health.plugins[]` entries gain `source` field (additive, non-breaking).
- WS broadcast: existing `plugin_config_update` reused, or a new `plugins_changed` event added (decision in design.md).

**Dependencies**: none new. Reuses existing `pi-resource-scanner.resolvePackagePath()`, `package-manager-wrapper`, `getPluginStatusStore()`.

**Operational**: cache invalidation timing is the only subtle concern — a plugin can ship a `bridge` entry that the dashboard auto-writes into pi's `settings.json#dashboardPluginBridges`; the user's running pi sessions need a reload to pick it up. This is the same constraint that already governs pi extension installs — no new behaviour to design here.
