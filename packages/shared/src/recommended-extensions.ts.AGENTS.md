# recommended-extensions.ts — index

Curated manifest of recommended pi extensions. `RecommendedExtension` (id, source, displayName, status, unlocks, requires, dashboardPlugin), `EnrichedRecommendedExtension`, `RECOMMENDED_EXTENSIONS` const (required/strongly-suggested/optional), `BUNDLED_EXTENSION_IDS` (git-only Electron pre-bundle set), `getRecommendedExtension(id)`, `getRecommendedByStatus(status)`. pi-dashboard-subagents floor >= 0.2.3 (emits `agentSessionId`); graceful-degrade to single-key on older producer. See change: resolve-subagent-inspector-by-session-id. Adds the `@blackbelt-technology/pi-dashboard-apple-tools` optional entry (dashboardPlugin `apple-tools`, requires `pi-mcp-adapter`). See change: add-apple-tools-imcp-plugin. `pi-mcp-adapter` row REMOVED; mcp-client entry has NO `requires`; apple-tools unlock text now says pi's built-in MCP. See change: migrate-mcp-to-pi-builtin. Adds the `@blackbelt-technology/pi-dashboard-forms-bpmn` optional entry (bundles openforms-mui + bpmn-package-explorer skills; npm: source, matched to the local monorepo install by name). Entry count 19→20. The canvas-render recipe is NOT bundled in that package — it relies on the dashboard `extension`'s own `canvas-webapp` skill (dropped the duplicate copy after verifying byte-identical).

See change: align-ui-with-theme-tokens. Subagents blurb "no background sessions."

## cleanup-post-r3-spec-drift

`BUNDLED_EXTENSION_IDS` doc-comment states the manifest is EMPTY (no installer pre-bundle path); dropped refs to `installBundledExtensions()`/`dependency-installer.ts`/`bundle-recommended-extensions.mjs`. See change: cleanup-post-r3-spec-drift.

## add-photocraft-plugin

Adds the `@blackbelt-technology/pi-dashboard-photocraft` optional entry (npm: source; unlocks photocraft skill + `pi-photocraft` CLI). See change: add-photocraft-plugin.

Replaces that entry with `@blackbelt-technology/pi-dashboard-craft-apps` (optional, npm: source; unlocks the `craft-studio` router skill + 13 per-app skills, `pi-craft` CLI, `pi-photocraft` alias). See change: add-craft-apps-core.
