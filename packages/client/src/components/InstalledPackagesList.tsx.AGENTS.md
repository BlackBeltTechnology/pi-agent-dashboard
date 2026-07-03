# InstalledPackagesList.tsx — index

Shared installed-packages list for Settings + Pi Resources. `PackageRow` per entry with update/uninstall/view-readme/move actions; chevron expands `ContainedResourcesTree` (skills/extensions/prompts). Move scope-swap via `usePackageOperations`, dedup against `otherScopePackages` via `computeDestIdentity`. Partial-success banner. Exports `InstalledPackagesList`.
