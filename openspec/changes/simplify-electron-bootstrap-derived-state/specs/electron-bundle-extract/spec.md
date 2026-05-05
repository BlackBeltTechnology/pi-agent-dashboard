## ADDED Requirements

### Requirement: Version-marker-driven extraction

The Electron app SHALL maintain a version marker `~/.pi-dashboard/.version` recording the exact bundle version that wrote the directory. Extraction SHALL be triggered when the marker is missing OR mismatches `app.getVersion()` OR the user invokes the manual reinstall action.

#### Scenario: First launch, no managed dir

- **WHEN** Electron launches AND `~/.pi-dashboard/` does not exist
- **THEN** `needsExtraction()` SHALL return `true`
- **AND** the extract flow SHALL run before the `extracted` source spawn

#### Scenario: Version match — reuse

- **WHEN** Electron launches AND `~/.pi-dashboard/.version` exists AND its content equals `app.getVersion()`
- **THEN** `needsExtraction()` SHALL return `false`
- **AND** the existing managed dir SHALL be reused without modification

#### Scenario: Version mismatch — re-extract

- **WHEN** Electron launches AND `~/.pi-dashboard/.version` content differs from `app.getVersion()`
- **THEN** `needsExtraction()` SHALL return `true`
- **AND** the migrate-then-wipe-then-extract sequence SHALL run

#### Scenario: Manual reinstall

- **WHEN** the user triggers `POST /api/electron/reinstall` AND the request is authorized (starter==Electron)
- **THEN** Electron SHALL schedule a restart with `forceReextract=true`
- **AND** on next launch the extract flow SHALL run regardless of marker state

### Requirement: Config migration on extract

Extraction SHALL preserve user configurations by archiving matched files to `~/.pi/dashboard/migrate/<ISO-timestamp>/` before wiping `~/.pi-dashboard/`. The archive directory SHALL be created with file move semantics (not copy) to keep disk usage flat.

#### Scenario: Config patterns archived

- **WHEN** the extract flow runs AND `~/.pi-dashboard/` contains files matching `*config*` OR `mode.json` OR `recommended-wizard.json` OR `api-key.json`
- **THEN** each matched file SHALL be moved to `~/.pi/dashboard/migrate/<timestamp>/<original-relative-path>`
- **AND** the archive SHALL preserve directory structure under the timestamp root

#### Scenario: Atomic wipe after archive

- **WHEN** the migrate step completes
- **THEN** the entire `~/.pi-dashboard/` directory SHALL be removed
- **AND** the directory SHALL be re-created empty before extraction begins

#### Scenario: No archive when nothing matches

- **WHEN** the extract flow runs AND `~/.pi-dashboard/` contains no files matching the archive patterns
- **THEN** the migrate step SHALL be a no-op
- **AND** no `~/.pi/dashboard/migrate/<timestamp>/` directory SHALL be created

### Requirement: Reinstall endpoint authorization

The `POST /api/electron/reinstall` endpoint SHALL be authorized only when the running server's `DASHBOARD_STARTER` is `"Electron"`. Other starters SHALL receive a 403 response with a descriptive error message.

#### Scenario: Reinstall allowed for Electron-started server

- **WHEN** `POST /api/electron/reinstall` is invoked AND the running server's starter is `"Electron"`
- **THEN** the endpoint SHALL return 202
- **AND** Electron SHALL schedule the restart with re-extract

#### Scenario: Reinstall denied for Bridge-started server

- **WHEN** `POST /api/electron/reinstall` is invoked AND the running server's starter is `"Bridge"`
- **THEN** the endpoint SHALL return 403
- **AND** the error body SHALL identify the starter that owns the server

#### Scenario: Reinstall denied for Standalone-started server

- **WHEN** `POST /api/electron/reinstall` is invoked AND the running server's starter is `"Standalone"`
- **THEN** the endpoint SHALL return 403
- **AND** the error body SHALL recommend stopping and restarting via Electron
