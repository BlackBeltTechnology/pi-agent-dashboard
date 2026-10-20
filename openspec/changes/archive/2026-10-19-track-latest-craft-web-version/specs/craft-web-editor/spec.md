## MODIFIED Requirements

### Requirement: Builds are prepared only on authenticated request and served read-only
The plugin SHALL download and install an app's web build only when a client with control authority asks to prepare it. A static asset request SHALL never trigger a download. Concurrent prepare requests for the same app and version SHALL yield one download.

Prepared builds SHALL be served without sign-in, cross-origin and without credentials, only for the app's currently prepared build. Unprepared builds SHALL answer "unavailable". A build prepared with an outdated host shim SHALL be reported as needing preparation. After the plugin or an app is disabled, its public build MAY remain served until the next server restart, while preparation and saves are refused immediately.

Each app SHALL have a version channel setting, `pinned` (default) or `latest`, read without a restart. With `pinned`, preparation SHALL use the verified version unless an env override decides it. With `latest`, preparation SHALL use the latest published web build. The status request MAY refresh the latest-version metadata in the background but SHALL NOT download a build. When a newer latest version than the prepared build is known, the app SHALL be reported as needing preparation with that version. When updating fails while a valid build is prepared, the prepared build SHALL stay available.

The plugin SHALL report per app: availability, version channel, resolved version, prepared state, approximate download size, and the reason when unavailable. Before the first load of an unprepared build, the editor SHALL state the approximate download size.

#### Scenario: Anonymous request never provisions
- **WHEN** an unauthenticated client requests an asset of an unprepared build
- **THEN** the server answers unavailable and makes no outbound request

#### Scenario: Offline first Edit
- **WHEN** the user selects the WordCraft mode on `report.docx`, the build is not prepared, and the server is offline
- **THEN** the mode shows that WordCraft could not be prepared, and the built-in preview still works

#### Scenario: Enabled but not yet restarted
- **WHEN** the plugin was enabled without a server restart and the user selects the WordCraft mode
- **THEN** the mode states that a server restart is required and loads nothing

#### Scenario: Newer latest release offered as update
- **WHEN** WordCraft's channel is `latest`, `0.8.0` is prepared, and the latest web build `0.9.0` is known
- **THEN** status reports WordCraft as needing preparation with version `0.9.0`, and preparing installs `0.9.0`

#### Scenario: Failed update keeps the prepared build
- **WHEN** WordCraft's channel is `latest`, `0.8.0` is prepared, and preparing `0.9.0` fails
- **THEN** status reports WordCraft available with version `0.8.0`

#### Scenario: Pinned channel ignores newer releases
- **WHEN** WordCraft's channel is `pinned` and a newer release exists
- **THEN** status makes no latest-release lookup and reports the verified version

## ADDED Requirements

### Requirement: Settings page edits per-app enable and version channel
The plugin SHALL contribute a section to its own settings page showing, per claimed app, an enable switch, a version channel selector, the installed and known latest versions, and the app status. Edits SHALL be saved through the page's global Save without dropping other stored config keys.

#### Scenario: Switch to latest from the settings page
- **WHEN** the user selects "Latest release" for WordCraft and saves
- **THEN** `plugins["craft-web"].apps.wordcraft.version` is `"latest"` and other stored keys are unchanged

### Requirement: Settings page downloads or updates an app
When an app needs preparation, the settings section SHALL offer an immediate Download action, labelled as an update when a build is installed. The action SHALL be unavailable while the section has unsaved edits.

#### Scenario: Update from the settings page
- **WHEN** WordCraft `0.8.0` is installed, status reports `0.9.0` needing preparation, and the user clicks the update action
- **THEN** WordCraft is prepared and the section shows `0.9.0` installed

#### Scenario: Unsaved edits block the update action
- **WHEN** the user changed the version selector without saving
- **THEN** the download/update action is disabled
