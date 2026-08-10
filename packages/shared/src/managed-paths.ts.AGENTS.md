# managed-paths.ts — index

Single source of truth for managed install dir `~/.pi-dashboard/`. Constants `MANAGED_DIR`, `MANAGED_BIN`, `PI_SETTINGS_PATH` reflect live env at load. Getters `getManagedDir(env?)`, `getManagedBin(env?)`, `getPiSettingsPath(env?)` accept optional `{ homedir }` override for tests.
