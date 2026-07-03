# PiResourcesView.tsx — index

Per-cwd Pi Resources view with Resources/Packages tabs. Exports `PiResourcesView`. Props: `cwd`, `onBack`, `onViewFile`. Resources tab renders `MergedScopeSection` (local + global) + `InstalledPackagesList` per scope from `usePiResources`. Packages tab embeds `PackageBrowser` (local scope). Wires `PackageInstallConfirmDialog` + `PackageReadmeDialog`.
