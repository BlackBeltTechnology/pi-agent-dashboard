# Tasks — resources-card-tabs

## 1. Shared types (`packages/shared/src/rest-api.ts`)
- [x] 1.1 Add `"agent"` to `PiResource.type` union → verify: `tsc` passes across workspaces.
- [x] 1.2 Add optional `model?: string` and `tools?: string` to `PiResource`.
- [x] 1.3 Add `agents: PiResource[]` to `PiResourceScope` → verify: existing consumers still compile.

## 2. Server scanner (agent discovery)
- [x] 2.1 Enumerate local `<cwd>/.pi/agents/*.md` → `type:"agent"` resources → verify: unit test scans a fixture dir.
- [x] 2.2 Enumerate global `~/.pi/agent/agents/*.md` at global scope → verify: global fixture test.
- [x] 2.3 Parse `model` + `tools` from agent frontmatter (reuse SKILL.md parser) → verify: metadata test.
- [x] 2.4 Missing `agents/` dir yields empty array (no throw) → verify: missing-dir test.
- [x] 2.5 Package-contributed agents surface with their `source` → verify: package fixture test.

## 3. Shared card component (`packages/client/src/components/`)
- [x] 3.1 `ResourceCard.tsx`: base card (icon, name, description, scope+source badges, path line, activation toggle) → verify: renders + toggle fires `activation.toggle`.
- [x] 3.2 Agent variant: `◆ model` + `🔧 tools` badges → verify: agent card test.
- [x] 3.3 Theme variant: swatch strip replaces description row → verify: swatch test.
- [x] 3.4 `ResourceCardGrid.tsx`: auto-fill grid + search filter + optional scope segmented control → verify: filter narrows rendered cards.
- [x] 3.5 Reuse `ActivationToggle` + `ResourceReloadBanner` (move/keep from `resource-tree.tsx`) → verify: reload banner still appears after a toggle.

## 4. Directory Settings (per-type pages)
- [x] 4.1 Extend `DirectorySettingsPage` union with `skills|agents|extensions|prompts|themes`; drop `resources`.
- [x] 4.2 `DirectorySettings.tsx` nav: `RESOURCES` group header + five items with count pills → verify: nav renders five items, `resources` gone.
- [x] 4.3 Route each page id to `ResourceCardGrid` filtered to its type (scope local+global, filter shown) → verify: Skills page shows only skill cards.
- [x] 4.4 Delete `DirectorySettings/ResourcesPage.tsx` and its route branch → verify: no dead import.

## 5. Global Settings (Resources group)
- [x] 5.1 Add `Resources` nav group to `SettingsPanel.tsx` `navGroups` with the five pages.
- [x] 5.2 Extend `VALID_SETTINGS_TABS` + `SettingsTab` with the five ids → verify: registry test; unknown-id claim still falls back to `general`.
- [x] 5.3 Route each page to `ResourceCardGrid` (global scope only → `◇ global` pill, no scope filter) → verify: Agents page renders global agents, no local/global filter.

## 6. Retire the tree
- [x] 6.1 Remove `MergedScopeSection`/`ResourceItem`/`ResourceGroup`/`PackageItem` from `resource-tree.tsx` once both surfaces use cards → verify: no remaining importer.
- [x] 6.2 Keep/relocate `ActivationToggle` + `ResourceReloadBanner` for the card → verify: `tsc` + grep for stale imports clean.

## 7. Tests + docs
- [x] 7.1 Migrate `PiResourcesView.*.test.tsx` + directory-settings resource tests from tree → card assertions → verify: `npm test` green.
- [x] 7.2 Update `openspec/specs` via sync after verify; update per-directory `AGENTS.md` rows for new/removed files. (AGENTS.md tree rows updated: components, DirectorySettings, hooks, server, routes, shared, dashboard-plugin. Spec deltas apply on `openspec archive`.)
- [x] 7.3 `npm run quality:changed` + `code-review` gate on the diff before commit. (biome clean on changed files bar a pre-existing `scanPackageDir` complexity warning — count unchanged; root `tsc --noEmit` 0 errors; new tests green; CodeRabbit deferred — rate-limited, advisory/non-blocking.)
