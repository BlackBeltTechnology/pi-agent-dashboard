# InstalledPackagesList.tsx — index

Shared installed-packages list for Settings + Pi Resources. `PackageRow` per entry with update/uninstall/view-readme/move actions; chevron expands `ContainedResourcesTree` (skills/extensions/prompts). Move scope-swap via `usePackageOperations`, dedup against `otherScopePackages` via `computeDestIdentity`. Partial-success banner. Rows pass `isOverride={isSourceOverride(pkg)}` → `override` pill. Exports `InstalledPackagesList`. See change: flag-package-source-overrides.


## reset-override-to-npm

Rows pass `publishedVariantSource/Version` + `onResetToNpm` (\u2192 `operations.resetToNpm(source,{scope,cwd})`) for ANY row with a variant. Partial-success uses the shared kind-aware `PackagePartialSuccessBanner`. See change: reset-override-to-npm.
