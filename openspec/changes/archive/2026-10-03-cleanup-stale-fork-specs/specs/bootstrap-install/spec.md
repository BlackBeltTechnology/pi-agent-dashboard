## REMOVED Requirements

### Requirement: Electron artifacts ship a per-platform offline npm cache
**Reason**: The offline npm cache and `offline-packages.json` were deleted; pi, openspec and tsx ship pre-installed inside the bundled server tree.
**Migration**: None. See change `eliminate-electron-runtime-install`; bundling is specified by `electron-build-pipeline` "Bundled dashboard server ships the pi runtime".

### Requirement: First-run installer uses bundled cache with --offline
**Reason**: There is no first-run installer and no offline cache.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Doctor surfaces bundle state
**Reason**: The offline bundle no longer exists, so there is no bundle state to report.
**Migration**: None. See change `eliminate-electron-runtime-install`. Doctor checks are specified by `electron-doctor-diagnostics`.

### Requirement: Single shared installer module
**Reason**: The shared bootstrap installer (`bootstrapInstall`) was deleted.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Degraded-mode startup
**Reason**: Degraded-mode startup was removed; an unresolvable pi is a hard startup error naming a corrupted `node_modules/` tree.
**Migration**: The hard-error behaviour is specified by `dashboard-server` "Startup fails hard when pi cannot be resolved", added by this change. See change `eliminate-electron-runtime-install`.

### Requirement: Bootstrap status API
**Reason**: The `/api/bootstrap/*` routes were removed.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Auto-register bridge after bootstrap
**Reason**: No bootstrap step exists to register the bridge after.
**Migration**: Bridge registration is specified by `electron-server-supervision` "Bundled bridge registration". See change `eliminate-electron-runtime-install`.

### Requirement: upgrade-pi CLI subcommand
**Reason**: The in-place pi upgrade path was removed; pi versions change only with a new app or bundle release.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Upgrade triggers session reload
**Reason**: No in-place pi upgrade exists to trigger a reload.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Global pi takes precedence
**Reason**: This described the precedence inside the deleted bootstrap installer.
**Migration**: None. See change `eliminate-electron-runtime-install`. Tool resolution order is specified by `tool-registry` "Ordered strategy chain with diagnostic trail".

### Requirement: Concurrent bootstrap serialization
**Reason**: No bootstrap install runs, so nothing needs serialising.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Electron wizard delegates to shared installer
**Reason**: The wizard no longer installs dependencies.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Bootstrap installs managed Node before pi/openspec/tsx
**Reason**: No bootstrap install runs.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Standalone npm install reaches bootstrap ready without prerequisites
**Reason**: pi, openspec and tsx are regular dependencies of the server package, so a standalone npm install needs no bootstrap phase.
**Migration**: Startup readiness for a standalone install is specified by `dashboard-server` "Startup fails hard when pi cannot be resolved". See change `eliminate-electron-runtime-install`.
