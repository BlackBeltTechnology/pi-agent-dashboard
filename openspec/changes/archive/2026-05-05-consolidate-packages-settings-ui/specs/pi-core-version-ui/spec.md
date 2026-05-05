## MODIFIED Requirements

### Requirement: Settings panel version section
The Settings panel SHALL include a unified packages section that contains three sub-groups: **Core**, **Recommended Extensions**, and **Other Packages**. Each sub-group SHALL render its rows using the same row component, and each package SHALL appear in exactly one sub-group, classified in priority order Core → Recommended → Other.

The "Pi Ecosystem" header (with `Last checked` timestamp and `Check Now` button) SHALL apply to the unified section as a whole.

#### Scenario: Three sub-groups rendered
- **WHEN** the user opens the Packages tab in Settings
- **THEN** the panel SHALL display sub-groups labeled "Core", "Recommended Extensions", and "Other Packages" in that vertical order
- **AND** each sub-group SHALL list its packages using the same row component

#### Scenario: Core group whitelist content
- **WHEN** the Core sub-group renders
- **THEN** it SHALL contain ONLY packages returned by `GET /api/pi-core/status` (i.e., the strict whitelist)
- **AND** Core rows SHALL NOT have an Uninstall affordance

#### Scenario: Recommended group cross-reference
- **WHEN** an installed package row's `source` matches an entry in `RECOMMENDED_EXTENSIONS` (via the existing `matchesRecommendedSource` helper)
- **THEN** the row SHALL appear in the Recommended Extensions sub-group
- **AND** the row's display name SHALL be the `displayName` from the recommended manifest, not the raw source string

#### Scenario: Other group fallthrough
- **WHEN** an installed package row is not in the Core whitelist AND not matched to any `RECOMMENDED_EXTENSIONS` entry
- **THEN** the row SHALL appear in the Other Packages sub-group

#### Scenario: No duplicate rows across groups
- **WHEN** a package is eligible for multiple groups (e.g., a Core whitelist member also listed in `settings.json packages[]`)
- **THEN** the package SHALL appear only in the highest-priority eligible group (Core wins over Recommended wins over Other)

#### Scenario: Row identity and source caption
- **WHEN** any package row is rendered
- **THEN** it SHALL display: a display name (friendly), a source caption (the raw `source` string), a source-type badge (`npm` / `git` / `local` / `global`), and a current version pill
- **AND** when `latestVersion` is known and differs from `currentVersion`, the row SHALL show "current → latest" with an Update affordance

#### Scenario: Bundled badge
- **WHEN** a recommended-extension row has `isBundled: true`
- **THEN** an additional `[bundled]` badge SHALL appear next to the source-type badge

#### Scenario: Update available shown
- **WHEN** a package has `updateAvailable: true`
- **THEN** the row SHALL show "current → latest" version text and an "Update" button

#### Scenario: Package up to date
- **WHEN** a package has `updateAvailable: false` (or `latestVersion` matches `currentVersion`)
- **THEN** the row SHALL show "✓ currentVersion"

#### Scenario: Update All button
- **WHEN** multiple packages in the Core sub-group have updates available
- **THEN** an "Update All (N)" button SHALL appear above the Core sub-group where N is the count of updatable Core packages

#### Scenario: Check Now button
- **WHEN** the user clicks "Check Now"
- **THEN** the section SHALL force-refresh both the Core data (`/api/pi-core/status?refresh=true`) and the installed-packages data (`/api/packages/check-updates`)
- **AND** show a loading state during the check

#### Scenario: Last checked timestamp
- **WHEN** version data is loaded
- **THEN** the section SHALL display "Last checked: X min ago" using the `lastChecked` field

#### Scenario: Update in progress
- **WHEN** a package update is running
- **THEN** the Update button SHALL show a spinner and be disabled
- **AND** progress messages SHALL be displayed inline on that row

#### Scenario: Update error displayed
- **WHEN** a package update fails
- **THEN** the error message SHALL be displayed below the package row

#### Scenario: Uninstall via row menu
- **WHEN** the user opens the kebab menu on a Recommended or Other row
- **THEN** an "Uninstall" action SHALL be available
- **AND** clicking it SHALL invoke the existing `/api/packages/remove` flow
- **AND** Core rows SHALL NOT show an Uninstall action
