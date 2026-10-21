# DOX — packages/client/src/lib/addons

Files in this directory. One row per source file. See change: addons-hub-feature-catalog.

| File | Purpose |
|------|---------|
| `addon-feature-helpers.ts` | Pure helpers: `featurePartChips`, `originBadgeLabel`, `originStripLabel`, `isLocalSourceFeature` (one predicate for chip, banner, badge), `groupFeatures(features, kind\|origin\|source\|az)`, `originCounts`, `filterFeatures` (AND chips + text over name/sources/description), `partLocalDescription`. |
| `addons-api.ts` | `fetchAddonCatalog`, `postAddonToggle` → `ok`/`stale`/`error` outcome; folder mode `fetchFolderAddonCatalog(cwd)`, `postFolderToggle` → `ok`/`trust`/`error`. See change: addons-hub-folder-view. |
| `addon-issues-store.ts` | Shared issue snapshot `{pluginIssues, health, count}`; `refreshAddonIssues` dedupes in-flight; failed health → plugin issues only. See change: addons-hub-folder-view. `refreshAddonHealth` = health-only refresh; `applyPluginsSnapshot` recomputes plugin issues from a `plugins_changed` snapshot with no `GET /api/plugins` (F6, task 8.86). See change: decouple-plugins-from-core. |
| `folder-addons-helpers.ts` | Pure folder-page helpers: `computeStrip` (off-globally never counted), `splitFolderGroups`, `filterFolderFeatures`, `looseTotal`. See change: addons-hub-folder-view. |
