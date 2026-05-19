## REMOVED Requirements

### Requirement: Loading-page inventory probe and reinstall actions

**Reason for removal:** The loading-page recovery surface offered `[Reinstall managed packages]` and `[Force reinstall]` buttons gated by an inventory diagnostic probe (`api.checkManagedInventory`). With no runtime install, there is nothing to reinstall and no inventory to probe. The buttons, their IPC channels, the diagnostic call, and the install-progress streaming UI all become unreachable code.

**Migration:** Recovery from a broken Electron install is now (1) restart the app, (2) reinstall the `.app` via `electron-updater` or by re-downloading from the release page, (3) for fine-grained diagnostics, use Doctor. The diagnostic capability previously exposed in the loading page is retained inside Doctor as read-only checks.

#### Scenario: Reinstall buttons removed

- **GIVEN** the loading page renders after a spawn failure
- **WHEN** the page DOM is inspected
- **THEN** no element with text `Reinstall managed packages` SHALL exist
- **AND** no element with text `Force reinstall` SHALL exist
- **AND** no Advanced disclosure containing install actions SHALL exist

#### Scenario: Inventory IPC channels removed

- **GIVEN** the Electron main process is running
- **WHEN** any IPC handler registry is enumerated
- **THEN** no handler for `dashboard:check-inventory` SHALL be registered
- **AND** no handler for `dashboard:reinstall-managed` SHALL be registered
- **AND** no handler for `dashboard:force-reinstall` SHALL be registered
- **AND** no handler for `dashboard:install-progress` SHALL be registered
