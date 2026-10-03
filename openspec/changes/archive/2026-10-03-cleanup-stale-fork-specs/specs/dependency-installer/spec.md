## REMOVED Requirements

### Requirement: Detect installed CLI tools
**Reason**: The `dependency-installer` capability is retired. The detection that still exists is specified elsewhere.
**Migration**: Covered by `electron-doctor-diagnostics` "CLI tool and runtime detection". The installer half was deleted by change `eliminate-electron-runtime-install`.

### Requirement: Standalone mode installation
**Reason**: `installStandalone()` and `dependency-installer.ts` were deleted, including the override that pinned the legacy `@mariozechner/pi-coding-agent` fork for the offline cache.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Power user mode verification and fix
**Reason**: Power-user dependency verification and fixing were deleted. The wizard's power-user *mode* still exists but installs nothing.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Managed install location
**Reason**: The managed directory is no longer an install target.
**Migration**: Managed path constants are covered by `electron-doctor-diagnostics` "Managed path resolution". The managed-bin PATH prepend for spawned processes is covered by the env-merge contract of `server-launch` "Single shared dashboard-server spawn primitive". The install half was deleted by change `eliminate-electron-runtime-install`.

### Requirement: TS loader resolution
**Reason**: `resolveTsLoader` was deleted. Loader resolution is owned by the shared tool resolver.
**Migration**: jiti resolution is specified by `server-launch` "Unified jiti resolution via `ToolResolver` anchored at earendil pi". See change `eliminate-electron-runtime-install`.

### Requirement: Bundled-extension activation runs before dynamic install
**Reason**: The wizard no longer runs a dynamic install sequence.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Recommended installer respects skipPackages from bundle
**Reason**: `installStandalone` and `installRecommendedExtensions` were deleted.
**Migration**: None. See change `eliminate-electron-runtime-install`.
