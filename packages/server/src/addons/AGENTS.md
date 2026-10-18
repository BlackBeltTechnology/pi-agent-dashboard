# DOX — packages/server/src/addons

Files in this directory. One row per source file. See change: addons-hub-feature-catalog.

| File | Purpose |
|------|---------|
| `addon-toggle-restore.ts` | Machine-local restore records `~/.pi/dashboard/addon-toggle-restore.json` (`{version,records}` keyed settingsPath+identity → `{original,filtered}`). Atomic tmp+rename; malformed/missing → empty + warn. `readRestoreStore`, `writeRestoreStore`, `get/set/deleteRestore`, `gcRestore(settingsPath, liveIdentities)`. Caller holds the settings lock. |
| `addons-catalog.ts` | Pure joiner `buildAddonCatalog(CatalogInputs)` → `AddonFeature[]`. Claim precedence: plugin own package · managed bridge · required by ≥2 plugins (`pkg:` + `requiredBy`) · recommended `dashboardPlugin` link · required by 1 plugin · rest `pkg:<identity>`. Derives kind/origin/authorLabels/state; order core → displayName → id. Also `pluginsRequiringPart`, `orphanManagedSources`. |
| `addons-service.ts` | I/O side. `gatherCatalog(deps)` (installed rows + settings entry state + plugins + recommended), `gcRestoreRecords`, `planToggle` (cascade, filtered/restored, keptOn, requiredBy, restoreSkipped, stillLoadedIn, digest `token`), `applyToggle` (records → entries → plugin flip; compensation; 500 `consistent:false` when it fails). `AddonsDeps` has test seams `setPluginsEnabled`, `writeSettingsText`. |
| `package-contents.ts` | `readPackageInfo(installedPath)` → `{name, contents:{extensions,skills,prompts,themes}}` from `package.json#pi` or convention dirs. Never throws. |
| `settings-entries.ts` | `packages[]` entry helpers: `readSettingsFile`, `entrySource`, `isAllEmptyFilter`, `filteredEntry`, `entriesEqual`, `entryIndicesFor`, atomic `writeSettingsText`, `scanFolderIdentities(knownDirs)` (read-only; skips `autoload:false` + all-empty entries). |
