# pi-core-updater.ts — index

Runs `npm install -g <pkg>@latest` (global) or `npm install <pkg>@latest` in `~/.pi-dashboard/` (managed) for pi core packages. `@latest` bypasses consuming `package.json` range for cross-minor upgrades. Exports `PiCoreUpdater` class (`update`, `setProgressListener`), `defaultRunNpmUpdate`, `UpdateProgressEvent`, `PiCoreUpdaterOptions`. Acquires PackageManagerWrapper `runExclusive` busy-lock; resolves `npm` via ToolRegistry + `prependManagedNodeToPath`. See change: fix-pi-core-update-cross-minor.

Default `_envBuilder` = `prependManagedNodeToPath(normalizeEnvPathKey(process.env))` — win32 `Path` collapsed to `PATH` before prepend, no `Path`/`PATH` pair. See change: fix-windows-path-env-key-casing.
