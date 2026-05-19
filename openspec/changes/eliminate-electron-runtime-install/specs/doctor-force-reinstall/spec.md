## REMOVED Requirements

### Requirement: Doctor force-reinstall surface

**Reason for removal:** The Doctor window's "Force reinstall managed packages" section invoked `planSafeWipe` + `installStandalone` to surgically wipe and reinstall the Electron-owned packages while preserving user `pi-*` extensions. With no managed packages in `~/.pi-dashboard/` and no install code path, the section is unreachable. The audit panel showing wipe vs preserve scope likewise has nothing to display.

**Migration:** Doctor retains every read-only diagnostic (binary versions, server status, log access, environment detection, legacy-managed-dir advisory). Recovery for a broken install routes to `electron-updater` (reinstall the `.app`).

#### Scenario: Force-reinstall section removed from Doctor

- **GIVEN** the Doctor window is opened
- **WHEN** the rendered DOM is inspected
- **THEN** no section heading `Force reinstall` SHALL be present
- **AND** no audit panel showing wipe/preserve scope SHALL render
- **AND** no `[Force reinstall managed packages]` button SHALL exist

#### Scenario: Force-reinstall IPC channels removed

- **GIVEN** the Doctor preload bridge is initialized
- **WHEN** the `DOCTOR_IPC_CHANNELS` constant is inspected
- **THEN** no channel name containing `force-reinstall` SHALL appear
- **AND** `window.electron.doctor` SHALL NOT expose any `forceReinstall*` method
- **AND** all read-only diagnostic channels (e.g. `doctor:run`, `doctor:open-log`) SHALL remain
