## ADDED Requirements

### Requirement: Version-skew attach modals are covered by the `_electron` suite

The `tests/e2e-electron/` suite SHALL cover the version-skew attach flows with the same stub technique as the zombie-adoption modal, running without `--no-zombie-prompt`. Fake `/api/health` fixtures for the existing zombie-adoption scenarios SHALL report the packaged app's expected runtime version, read from its bundled `runtime-manifest.json` rather than hard-coded, so those scenarios keep reaching the three-button modal.

#### Scenario: Merged modal is reached for a skewed zombie

- **GIVEN** the packaged app attaches to a fake `/api/health` reporting a zombie whose `version` differs from the bundled manifest version
- **WHEN** the attach arm runs
- **THEN** the stubbed `dialog.showMessageBox` SHALL be called once with "Restart with v<expected>", "Take ownership" and "Leave running"

#### Scenario: Informational modal never stops an external server

- **GIVEN** the packaged app attaches to a fake `/api/health` reporting `launchSourceEffective: "standalone"` and a different `version`
- **WHEN** the attach arm runs and the stub returns "OK"
- **THEN** the informational modal SHALL have been shown
- **AND** no `/api/shutdown` request SHALL reach the fake server

#### Scenario: Zombie fixture version follows the bundle

- **WHEN** the zombie-adoption scenarios build their fake `/api/health`
- **THEN** its `version` SHALL equal the packaged app's bundled `runtime-manifest.json` version
