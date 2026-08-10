# pi-core-version-ui Specification

## Purpose
UI affordances in Settings → Pi Ecosystem for displaying installed pi-ecosystem versions, surfacing available updates, and giving users access to release notes / changelog content for the canonical core packages.
## Requirements
### Requirement: Settings panel version section
The Settings panel SHALL include a unified packages section that contains three sub-groups: **Core**, **Recommended Extensions**, and **Other Packages**. Each sub-group SHALL render its rows using the same row component, and each package SHALL appear in exactly one sub-group, classified in priority order Core → Recommended → Other.

A local/git-installed row has a **resolvable published variant** when the server exposes `InstalledPackage.publishedVariantSource` (the canonical `npm:<name>` or git spec) for it — resolved via `RECOMMENDED_EXTENSIONS` for recommended rows, or an npm-registry lookup by `package.json name` for non-recommended local rows. Such a row SHALL render TWO source lines: the installed `local`/`git` path AND the published link labeled with its available version (`publishedVariantVersion`). The published line SHALL carry an inline **Reset to npm** affordance, and the `⋮` overflow menu SHALL include a **Reset to published version** item.

The reset action SHALL be gated behind a confirmation dialog whose copy states that the local checkout *link* (not the on-disk files) is discarded and the published version installed, naming the exact published target. When `publishedVariantSource` is absent the row SHALL render a single source line and NO reset action.

The reset action SHALL NOT alter the existing Update, Uninstall, or Move affordances on any row, and plain npm-installed rows SHALL be unchanged.

#### Scenario: Dual source lines + reset on a row with a published variant
- **WHEN** a local/git row has a `publishedVariantSource`
- **THEN** the row SHALL render both the installed path AND the published link with its available version
- **AND** SHALL offer an inline "Reset to npm" and a "Reset to published version" `⋮`-menu item

#### Scenario: Non-recommended local row resolved by npm-name lookup
- **WHEN** a non-recommended local row's `package.json name` resolves to a published npm package (surfaced as `publishedVariantSource`)
- **THEN** the row SHALL surface the second source line + reset action, identically to a recommended override

#### Scenario: No reset without a resolvable published variant
- **WHEN** a local/git row has no `publishedVariantSource` on the wire
- **THEN** the row SHALL render a single source line and SHALL NOT render a reset action

#### Scenario: Plain npm rows unchanged
- **WHEN** a row is installed from an `npm:` source
- **THEN** it SHALL render a single source line with no second published link and no reset action

#### Scenario: Confirmation required before reset
- **WHEN** the user clicks "Reset to npm" or the "Reset to published version" menu item
- **THEN** a confirmation dialog SHALL appear naming the discarded local/git link and the exact published target
- **AND** the reset SHALL run only after explicit confirmation

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

### Requirement: Pi-core update state survives component unmount

The Core sub-group of `UnifiedPackagesSection` SHALL render the in-flight state of pi-core updates by reading from the singleton `packageQueue`, not from component-local React state. Navigation away from `Settings → Pi Ecosystem` (causing `UnifiedPackagesSection` to unmount) followed by navigation back (causing it to remount) SHALL NOT reset the in-flight state.

This requirement closes a UX bug in which an update started on a core package would render a working spinner for several seconds, then revert to an enabled "Update" button after the user navigated away and back. Clicking the apparently-idle button produced a 409 `PackageOperationBusyError` (red error text directly under the button) because the original update was still running on the server. The fix is to route pi-core operations through the existing `packageQueue` singleton instead of keeping the state in `useState`.

#### Scenario: Update spinner survives unmount/remount

- **GIVEN** the user clicked Update on the `pi (core agent)` row (display name for `@mariozechner/pi-coding-agent`) in `Settings → Pi Ecosystem`
- **AND** the row is rendering its busy state (spinner + progress message)
- **WHEN** the user navigates to a different sidebar entry, causing `UnifiedPackagesSection` to unmount
- **AND** later navigates back to Settings, causing `UnifiedPackagesSection` to remount
- **THEN** the pi row SHALL render its busy state again (spinner + the most-recent progress message)
- **AND** the row's Update button SHALL NOT be clickable

#### Scenario: Progress events received while component is unmounted are visible on remount

- **GIVEN** the user has started a pi-core update for `@mariozechner/pi-coding-agent` and unmounted the component
- **WHEN** a `pi_core_update_progress` event arrives via WebSocket while the component is unmounted
- **THEN** the queue SHALL update its running op's `message` field
- **AND** when the component remounts, the row SHALL display the most-recent message via `operations.operation.message` (when `runningSource === "pi-core:" + pkg.name`, e.g. `"pi-core:@mariozechner/pi-coding-agent"`)

#### Scenario: Completion finalizes state regardless of mount status

- **WHEN** a pi-core update's POST resolves with success while the component is unmounted
- **THEN** the queue clears its `running` slot and seeds `successBySource` for `"pi-core:" + name`
- **AND** the next mount of `UnifiedPackagesSection` renders the row in its post-completion state (typically idle, possibly with a transient success indicator)

### Requirement: Core sub-group rows read from `usePackageOperations`

The Core sub-group of `UnifiedPackagesSection` SHALL NOT maintain `coreUpdating`, `coreProgress`, or `coreErrors` in component-local `useState`. The Core sub-group SHALL NOT register its own `pi-core-event` `addEventListener` for in-flight tracking. The component SHALL read state via `usePackageOperations(scope: "global")` and render `<PackageRow>` props using the hook's `runningSource`, `operation.message`, `statusFor("pi-core:" + name)`, and `messageFor("pi-core:" + name)` accessors — identical to how the Recommended-Extensions and Other-Packages sub-groups already work for their rows.

The Core sub-group's "Update Individual" `onUpdate` SHALL call `operations.coreUpdate(name)`. The Core sub-group's "Update All" `onClick` SHALL iterate over the updatable list and invoke `operations.coreUpdate(name)` for each.

The version-list refresh after completion (currently the inline `refresh(true)` call) is independently driven by `usePiCoreVersions`'s existing `pi-core-event` listener and SHALL remain in place — it is not affected by this change.

#### Scenario: Core row Update button calls coreUpdate

- **WHEN** the user clicks Update on the `pi (core agent)` Core row (whose `pkg.name` is `@mariozechner/pi-coding-agent`)
- **THEN** the component invokes `operations.coreUpdate("@mariozechner/pi-coding-agent")`
- **AND** the queue subsequently POSTs `/api/pi-core/update` with `{packages: ["@mariozechner/pi-coding-agent"]}`

#### Scenario: Core row reads busy from runningSource

- **WHEN** the queue's `runningSource` is `"pi-core:@mariozechner/pi-coding-agent"`
- **THEN** the `pi (core agent)` row renders `busy = true` and shows the in-flight progress message

#### Scenario: Core row reads error from queue's per-source map

- **WHEN** a pi-core update for `@mariozechner/pi-coding-agent` fails and the queue records `errorBySource.set("pi-core:@mariozechner/pi-coding-agent", { message: "..." })`
- **THEN** the `pi (core agent)` row renders the error text underneath
- **AND** the row's Update button is enabled again (the error is sticky until the next enqueue, matching today's behavior)

#### Scenario: Update All produces serialized per-row state

- **GIVEN** the user clicks Update All with 3 updatable Core packages
- **THEN** the first row enters the `running` state
- **AND** the other two rows enter the `queued` state
- **WHEN** each row's update completes, the next row transitions from `queued` to `running` automatically

