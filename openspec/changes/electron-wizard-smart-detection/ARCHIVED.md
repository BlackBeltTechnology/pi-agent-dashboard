# Archived — electron-wizard-smart-detection

**Archived**: 2026-05-04  
**Superseded by**: `simplify-electron-bootstrap-derived-state`

The smart detection logic (`decideStartupAction`, `detectPi`, `detectBridgeExtension` branching in `main.ts`) is replaced by `selectLaunchSource()` in `simplify-electron-bootstrap-derived-state` Phase C.

The V2 resolver probes sources in priority order (attach → devMonorepo → piExtension → npmGlobal → extracted) without persisting any wizard-completion state to disk. The `isFirstRun()` / `mode.json` check is removed from the primary launch path.
