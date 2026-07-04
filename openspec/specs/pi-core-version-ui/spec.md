# pi-core-version-ui Specification

## Purpose
UI affordances in Settings → Pi Ecosystem for displaying installed pi-ecosystem versions, surfacing available updates, and giving users access to release notes / changelog content for the canonical core packages.
## Requirements
### Requirement: Settings panel version section
The Settings panel SHALL include a unified packages section that contains three sub-groups: **Core**, **Recommended Extensions**, and **Other Packages**. Each sub-group SHALL render its rows using the same row component, and each package SHALL appear in exactly one sub-group, classified in priority order Core → Recommended → Other.

The "Pi Ecosystem" header (with `Last checked` timestamp and `Check Now` button) SHALL apply to the unified section as a whole.

A package row is a **source override** when it has a canonical npm identity (`isRecommended === true`, i.e. its `source` matched a `RECOMMENDED_EXTENSIONS` entry whose declared source is `npm:<name>`) BUT its actual installed `source` is not an npm spec (`classifySource(source) !== "npm"`) — "declared as npm, installed from a local/git checkout". This predicate is derived client-side via `isSourceOverride(pkg)` from existing `InstalledPackage` fields; it requires no server payload change. The override remark SHALL be driven by this boolean. This change adds a verbal remark only; it does NOT gate, disable, or otherwise alter the Update affordance on any row.

`classifySource` SHALL bucket a `git:<host>/<owner>/<repo>` source as `git` (consistent with `parseSourceKey`/`sourcesMatch`), so a git-prefixed override renders a `git` badge — not `global` — and is gated identically to other git installs.

Detection reads `InstalledPackage.isRecommended`, which is optional on the wire type; the `=== true` test makes an un-enriched row resolve to non-override (Update remains enabled). All current list paths enrich rows before render.

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

#### Scenario: Source-override remark rendered
- **WHEN** a row satisfies `isSourceOverride(pkg)` (recommended npm identity, actual source `git` or `local`)
- **THEN** the row SHALL render a compact `override` pill adjacent to the source-type badge
- **AND** the `override` pill SHALL expose a tooltip / `aria-label` of the form "Declared as npm:`<name>` but installed from a `<local|git>` source"
- **AND** the row SHALL NOT reuse the `dev` marker for this remark (that marker renders the literal word `dev` and would mislead)

#### Scenario: Bundled badge
- **WHEN** a recommended-extension row has `isBundled: true`
- **THEN** an additional `[bundled]` badge SHALL appear next to the source-type badge

#### Scenario: Update available shown
- **WHEN** a package has `updateAvailable: true`
- **THEN** the row SHALL show "current → latest" version text and an active "Update" button
- **AND** this behavior SHALL be identical for source-override and non-override rows (this change does not gate Update)

#### Scenario: Git-prefixed override badges as git
- **GIVEN** a recommended extension whose installed `source` is `git:github.com/Owner/repo` (matched to its `npm:` identity via `sourcesMatch`, so `isRecommended === true`)
- **THEN** `classifySource(source)` SHALL return `git` and the row SHALL render a `git` badge (NOT `global`)
- **AND** `isSourceOverride(pkg)` SHALL be `true`, so the row SHALL render the `override` pill

#### Scenario: Non-recommended local/git rows are unchanged
- **WHEN** a row is installed from a local path or git source AND `isRecommended` is not `true`
- **THEN** `isSourceOverride(pkg)` SHALL be `false`
- **AND** the row SHALL NOT render the `override` pill
- **AND** the row's existing Update behavior SHALL be unchanged

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

### Requirement: Header update badge
The app header SHALL display a badge when core pi package updates are available.

#### Scenario: Badge visible with count
- **WHEN** `updatesAvailable > 0` from the version status
- **THEN** a small badge SHALL appear in the header showing the update count (e.g., "⬆ 2")

#### Scenario: Badge hidden when current
- **WHEN** `updatesAvailable === 0`
- **THEN** the badge SHALL not be rendered

#### Scenario: Badge click navigates to settings
- **WHEN** the user clicks the update badge
- **THEN** the app SHALL navigate to the Settings panel

#### Scenario: Badge polls periodically
- **WHEN** the app is open
- **THEN** the badge SHALL fetch version status on mount and every 30 minutes thereafter

### Requirement: Version check hook
The client SHALL provide a `usePiCoreVersions` hook for fetching and polling core version status.

#### Scenario: Initial fetch on mount
- **WHEN** the hook mounts
- **THEN** it SHALL fetch `GET /api/pi-core/versions` and return the `PiCoreStatus` data

#### Scenario: Periodic polling
- **WHEN** the hook is mounted
- **THEN** it SHALL re-fetch every 30 minutes

#### Scenario: Manual refresh
- **WHEN** `refresh()` is called
- **THEN** the hook SHALL re-fetch with `?refresh=true`

#### Scenario: Refresh after update complete
- **WHEN** a `package_operation_complete` WebSocket message is received with a core package source
- **THEN** the hook SHALL re-fetch version data

### Requirement: Breaking-change icon on Core rows
The Core sub-group of `UnifiedPackagesSection` SHALL render a "what's new" icon next to the row's `[Update]` button whenever a non-empty changelog is available between the row's installed and latest versions, regardless of whether the changelog contains breaking changes.

The icon SHALL render in one of two visual states:

- **Breaking state** — `mdiAlertCircleOutline` from `@mdi/js`, amber color (`text-amber-400`), `aria-label` "Breaking changes since your version — click for details" — used when the changelog contains ≥1 `### Breaking Changes` section in range.
- **Info state** — `mdiInformationOutline` from `@mdi/js`, muted color (`text-[var(--text-muted)]`), `aria-label` "View what's new — click to see release notes" — used when the changelog has releases in range but no breaking changes.

The icon SHALL NOT render when the changelog endpoint returned `releases: []` (no release notes available for the range).

#### Scenario: Breaking icon when breaking changes exist
- **WHEN** a Core row's package has `updateAvailable: true`
- **AND** `GET /api/pi-core/changelog?pkg=<row.name>&from=<currentVersion>&to=<latestVersion>` returns `hasBreaking: true`
- **THEN** the row SHALL render the amber `mdiAlertCircleOutline` icon between the version arrow and the `[Update]` button

#### Scenario: Info icon when no breaking changes but releases exist
- **WHEN** the changelog response returns `hasBreaking: false`
- **AND** `releases.length > 0`
- **THEN** the row SHALL render the muted `mdiInformationOutline` icon between the version arrow and the `[Update]` button
- **AND** the row's existing `[Update]` button SHALL remain functional

#### Scenario: Icon hidden when no releases
- **WHEN** the changelog response returns `releases: []`
- **OR** the package has `updateAvailable: false`
- **THEN** the row SHALL NOT render any what's-new icon

#### Scenario: Icon hidden for non-pi packages
- **WHEN** the row's package name is not `@mariozechner/pi-coding-agent` (or its declared successor)
- **THEN** the row SHALL NOT render any what's-new icon, regardless of changelog response
- **AND** the changelog endpoint SHALL NOT be requested for that row

#### Scenario: Icon hidden during loading and error states
- **WHEN** the changelog request is in flight
- **OR** the changelog request failed
- **THEN** the row SHALL NOT render any what's-new icon
- **AND** the row's existing `[Update]` button SHALL remain functional

#### Scenario: Icon click opens WhatsNewDialog
- **WHEN** the user clicks any what's-new icon (breaking or info state)
- **THEN** the section SHALL open `WhatsNewDialog` populated with the changelog response that produced the icon
- **AND** the dialog's `[Update to <latest>]` CTA SHALL be wired to the same `onUpdate` handler as the row's `[Update]` button

#### Scenario: Tooltip text matches state
- **WHEN** the user hovers the icon (pointer devices) in breaking state
- **THEN** a tooltip SHALL display "<N> breaking change(s) since your version" where N is the count of breaking-change bullets across all releases in the response
- **WHEN** the user hovers the icon in info state
- **THEN** a tooltip SHALL display "View what's new"

### Requirement: On-demand changelog fetch
The Core sub-group SHALL fetch the changelog for `@mariozechner/pi-coding-agent` lazily — only when an update is available — and reuse the cached result for subsequent renders within the same session.

#### Scenario: Fetch triggered when update appears
- **WHEN** `usePiCoreVersions` reports the pi row transitioning from `updateAvailable: false` to `updateAvailable: true`
- **THEN** the section SHALL issue exactly one `GET /api/pi-core/changelog` request for that version range
- **AND** SHALL NOT issue duplicate requests for the same `(currentVersion, latestVersion)` pair within the same session

#### Scenario: No fetch when up to date
- **WHEN** the pi row reports `updateAvailable: false`
- **THEN** the section SHALL NOT issue any changelog request

#### Scenario: Re-fetch after pi update completes
- **WHEN** a `package_operation_complete` WebSocket message is received for `@mariozechner/pi-coding-agent`
- **AND** the post-update version comparison again yields `updateAvailable: true` (e.g., another release landed)
- **THEN** the section SHALL re-issue the changelog request for the new range

#### Scenario: Failure does not block row interaction
- **WHEN** the changelog request fails (network error, 4xx, 5xx)
- **THEN** the section SHALL NOT display the icon
- **AND** the row's `[Update]` button SHALL remain enabled and functional
- **AND** an error MAY be logged client-side but SHALL NOT be displayed inline on the row

### Requirement: Auto-check installed packages for updates
The dashboard SHALL automatically check installed packages for available updates without requiring the user to click `[Check Now]`. This mirrors pi's interactive-TUI behaviour, which runs `packageManager.checkForAvailableUpdates()` on every startup.

#### Scenario: Auto-check fires on mount
- **WHEN** `UnifiedPackagesSection` mounts AND the initial installed-packages list has loaded
- **THEN** the section SHALL issue `POST /api/packages/check-updates` exactly once, automatically, without user interaction
- **AND** populate the per-row `updateAvailable` indicator from the response

#### Scenario: Auto-check polls periodically
- **WHEN** `UnifiedPackagesSection` is mounted
- **THEN** the section SHALL re-issue `POST /api/packages/check-updates` every 30 minutes
- **AND** the polling cadence SHALL be cancelled on unmount

#### Scenario: Auto-check re-fires after package operation
- **WHEN** a `package_operation_complete` WS message is received with `success: true`
- **THEN** the section SHALL re-issue `POST /api/packages/check-updates`
- **AND** the updated `updateAvailable` set SHALL be reflected on every affected row immediately

#### Scenario: Manual Check Now still works
- **WHEN** the user clicks the `[Check Now]` button
- **THEN** the section SHALL issue `POST /api/packages/check-updates` immediately
- **AND** the auto-poll timer SHALL be reset to 30 minutes from the manual click

#### Scenario: Auto-check failure does not disrupt UI
- **WHEN** the auto-check request fails (network, 4xx, 5xx)
- **THEN** the section SHALL NOT display an inline error
- **AND** the next scheduled poll SHALL still fire
- **AND** existing rows SHALL continue to render whatever update state was last successfully fetched

