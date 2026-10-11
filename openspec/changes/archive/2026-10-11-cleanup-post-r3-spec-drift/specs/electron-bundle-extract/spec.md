## REMOVED Requirements

### Requirement: Version-marker-driven extraction

**Reason**: The packaged app no longer extracts its payload into `~/.pi-dashboard/`. It runs the server directly from the read-only `<resourcesPath>/server/` tree (change `eliminate-electron-runtime-install`). `needsExtraction`, `extractBundle` and the `~/.pi-dashboard/.version` marker have no code left under `packages/`.
**Migration**: "Launch-source probe contracts" → "bundled probe" (`electron-launch-source`) owns how the packaged server is located. A damaged bundle surfaces as `BundledServerMissingError`; recovery is reinstalling the app.

### Requirement: Config migration on extract

**Reason**: There is no extract-and-wipe of `~/.pi-dashboard/`, so there is nothing to archive user configs ahead of.
**Migration**: None. User config under `~/.pi/dashboard/` is never wiped by launch.

### Requirement: Reinstall endpoint authorization

**Reason**: `POST /api/electron/reinstall` no longer exists (no route under `packages/`). There is no re-extract for it to schedule.
**Migration**: None. Reinstall means reinstalling the app; runtime updates go through the runtime-overlay flow ("Overlay and local-link launch sources").
