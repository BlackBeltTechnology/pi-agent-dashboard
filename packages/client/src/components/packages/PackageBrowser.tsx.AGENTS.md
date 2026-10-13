# PackageBrowser.tsx — index

Main package management surface. Exports `PackageBrowser`. Props: `scope`, `cwd`, `onViewReadme`, `onConfirmInstall`, `showInstalledSection`. Composes `RecommendedExtensions` + installed `PackageRow` list + URL install input + npm search (`usePackageSearch`) + type-filter pills + `PackageCard` grid. Source-keyed `installedInfo` map detects cross-scope installs. Checks updates via `/api/packages/check-updates`. Installed rows here are non-recommended only → never source overrides (no `override` pill). See change: flag-package-source-overrides.

## addons-hub-declutter

New prop `hideGlobalInstalledRecommended` → `RecommendedExtensions.hideGlobalInstalled`. Installed section skips `dashboardManaged` rows. Listens for `ADDONS_NPM_SEARCH_EVENT` → sets search query + focuses input. See change: addons-hub-declutter.
