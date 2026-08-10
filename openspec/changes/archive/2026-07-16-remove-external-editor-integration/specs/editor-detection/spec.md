# editor-detection

Entire capability removed: the dashboard no longer auto-detects a `code-server` binary, renders an install guide, or carries editor config fields.

## REMOVED Requirements

### Requirement: Auto-detect code-server binary

**Reason**: No external editor is launched, so no binary is detected.
**Migration**: N/A — internal Monaco pane requires no host binary.

### Requirement: EditorInstallGuide

**Reason**: The install-guide UI is removed with the launcher.
**Migration**: N/A — nothing to install.

### Requirement: Config fields

**Reason**: `EditorConfig` (`binaryPath`, `idleTimeoutMinutes`, `maxInstances`, `stopOnDashboardExit`, …) is removed from `DashboardConfig`.
**Migration**: A stale `"editor": {…}` block in an existing `settings.json` is ignored (not an error); no user action needed.
