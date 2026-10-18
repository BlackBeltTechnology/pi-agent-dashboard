# DOX — packages/client/src/lib/addons

Files in this directory. One row per source file. See change: addons-hub-feature-catalog.

| File | Purpose |
|------|---------|
| `addon-feature-helpers.ts` | Pure helpers: `featurePartChips`, `originBadgeLabel`, `originStripLabel`, `isLocalSourceFeature` (one predicate for chip, banner, badge), `groupFeatures(features, kind\|origin\|source\|az)`, `originCounts`, `filterFeatures` (AND chips + text over name/sources/description), `partLocalDescription`. |
| `addons-api.ts` | `fetchAddonCatalog`, `postAddonToggle` → `ok`/`stale`/`error` outcome. |
