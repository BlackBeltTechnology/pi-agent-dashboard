## MODIFIED Requirements

### Requirement: Settings panel version section

The Settings panel SHALL include a unified packages section that contains three sub-groups: **Core**, **Recommended Extensions**, and **Other Packages**. Each sub-group SHALL render its rows using the same row component, and each package SHALL appear in exactly one sub-group, classified in priority order Core → Recommended → Other.

The "Pi Ecosystem" header (with `Last checked` timestamp and `Check Now` button) SHALL apply to the unified section as a whole.

**Modification:** when `GET /api/health` returns `launchSource: "electron"`, the **Core** sub-group SHALL NOT render. The "Pi Ecosystem" header, the `Update All` Core button, and the `Check Now` Core probe are part of the Core sub-group and SHALL also be hidden. The **Recommended Extensions** and **Other Packages** sub-groups SHALL continue to render in all arms.

In the standalone (`npm i -g`) and bridge (pi-extension) arms, all three sub-groups render as before. The backing endpoints (`/api/pi-core/versions`, `/api/pi-core/update`, `/api/pi-core/changelog`) and their server-side modules (`pi-core-checker.ts`, `pi-core-updater.ts`, `changelog-parser.ts`) are unchanged.

**Rationale:** the Electron arm ships pi inside the read-only `.app`/`.deb`/`.AppImage`/`.exe` bundle. There is no writable `node_modules` to upgrade pi into at runtime. Pi-version updates for the Electron arm ride a normal dashboard release via `electron-updater` whole-app replacement.

#### Scenario: Electron arm hides Core sub-group

- **GIVEN** the client has fetched `/api/health` and received `launchSource: "electron"`
- **WHEN** the user opens the Packages tab in Settings
- **THEN** the panel SHALL display only the Recommended Extensions and Other Packages sub-groups
- **AND** no "Pi Ecosystem" header, no "Update All" button, no Core rows SHALL render
- **AND** clicking any pi extension's row in Recommended or Other SHALL function as before

#### Scenario: Standalone arm renders all three sub-groups

- **GIVEN** the client has fetched `/api/health` and received `launchSource: "standalone"`
- **WHEN** the user opens the Packages tab in Settings
- **THEN** the panel SHALL display all three sub-groups (Core, Recommended Extensions, Other Packages)
- **AND** the Pi Ecosystem header SHALL render with `Last checked` + `Check Now`
- **AND** Core rows SHALL show updates when available

#### Scenario: Bridge arm renders all three sub-groups

- **GIVEN** the client has fetched `/api/health` and received `launchSource: "bridge"`
- **WHEN** the user opens the Packages tab in Settings
- **THEN** the panel SHALL render identically to the standalone arm

#### Scenario: Health probe in flight defaults to showing Core

- **GIVEN** the `/api/health` probe is still in flight (no `launchSource` value yet)
- **WHEN** the user opens the Packages tab in Settings
- **THEN** the panel SHALL render the Core sub-group (fail-open default)
- **AND** when the probe resolves to `"electron"` the Core sub-group SHALL hide on the next render

### Requirement: Header update badge

The app header SHALL display a badge when core pi package updates are available.

**Modification:** when `GET /api/health` returns `launchSource: "electron"`, the header update badge SHALL NOT render regardless of the underlying `updatesAvailable` count. In the standalone and bridge arms, the badge renders as before.

#### Scenario: Electron arm hides update badge

- **GIVEN** `launchSource === "electron"`
- **WHEN** `/api/pi-core/versions` reports `updatesAvailable > 0`
- **THEN** the header SHALL NOT render the update badge

#### Scenario: Standalone arm shows update badge

- **GIVEN** `launchSource === "standalone"` AND `updatesAvailable > 0`
- **WHEN** the app header renders
- **THEN** the update badge SHALL render with the count
