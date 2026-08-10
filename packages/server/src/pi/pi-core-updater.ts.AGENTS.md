# pi-core-updater.ts — index

Runs `npm install -g <pkg>@latest` (global) or `npm install <pkg>@latest` in `~/.pi-dashboard/` (managed) for pi core packages. `@latest` bypasses consuming `package.json` range for cross-minor upgrades. Exports `PiCoreUpdater` class (`update`, `setProgressListener`), `defaultRunNpmUpdate`, `UpdateProgressEvent`, `PiCoreUpdaterOptions`. Acquires PackageManagerWrapper `runExclusive` busy-lock; resolves `npm` via ToolRegistry + `prependManagedNodeToPath`. See change: fix-pi-core-update-cross-minor.
