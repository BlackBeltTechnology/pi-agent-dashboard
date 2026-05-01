## ADDED Requirements

### Requirement: Pi-core update state survives component unmount

The Core sub-group of `UnifiedPackagesSection` SHALL render the in-flight state of pi-core updates by reading from the singleton `packageQueue`, not from component-local React state. Navigation away from `Settings → Pi Ecosystem` (causing `UnifiedPackagesSection` to unmount) followed by navigation back (causing it to remount) SHALL NOT reset the in-flight state.

This requirement closes a UX bug in which an update started on a core package would render a working spinner for several seconds, then revert to an enabled "Update" button after the user navigated away and back. Clicking the apparently-idle button produced a 409 `PackageOperationBusyError` (red error text directly under the button) because the original update was still running on the server. The fix is to route pi-core operations through the existing `packageQueue` singleton instead of keeping the state in `useState`.

#### Scenario: Update spinner survives unmount/remount

- **GIVEN** the user clicked Update on `pi (core agent)` in `Settings → Pi Ecosystem`
- **AND** the row is rendering its busy state (spinner + progress message)
- **WHEN** the user navigates to a different sidebar entry, causing `UnifiedPackagesSection` to unmount
- **AND** later navigates back to Settings, causing `UnifiedPackagesSection` to remount
- **THEN** the pi row SHALL render its busy state again (spinner + the most-recent progress message)
- **AND** the row's Update button SHALL NOT be clickable

#### Scenario: Progress events received while component is unmounted are visible on remount

- **GIVEN** the user has started a pi-core update and unmounted the component
- **WHEN** a `pi_core_update_progress` event arrives via WebSocket while the component is unmounted
- **THEN** the queue SHALL update its running op's `message` field
- **AND** when the component remounts, the row SHALL display the most-recent message via `operations.operation.message` (when `runningSource === "pi-core:" + pkg.name`)

#### Scenario: Completion finalizes state regardless of mount status

- **WHEN** a pi-core update's POST resolves with success while the component is unmounted
- **THEN** the queue clears its `running` slot and seeds `successBySource` for `"pi-core:" + name`
- **AND** the next mount of `UnifiedPackagesSection` renders the row in its post-completion state (typically idle, possibly with a transient success indicator)

### Requirement: Core sub-group rows read from `usePackageOperations`

The Core sub-group of `UnifiedPackagesSection` SHALL NOT maintain `coreUpdating`, `coreProgress`, or `coreErrors` in component-local `useState`. The Core sub-group SHALL NOT register its own `pi-core-event` `addEventListener` for in-flight tracking. The component SHALL read state via `usePackageOperations(scope: "global")` and render `<PackageRow>` props using the hook's `runningSource`, `operation.message`, `statusFor("pi-core:" + name)`, and `messageFor("pi-core:" + name)` accessors — identical to how the Recommended-Extensions and Other-Packages sub-groups already work for their rows.

The Core sub-group's "Update Individual" `onUpdate` SHALL call `operations.coreUpdate(name)`. The Core sub-group's "Update All" `onClick` SHALL iterate over the updatable list and invoke `operations.coreUpdate(name)` for each.

The version-list refresh after completion (currently the inline `refresh(true)` call) is independently driven by `usePiCoreVersions`'s existing `pi-core-event` listener and SHALL remain in place — it is not affected by this change.

#### Scenario: Core row Update button calls coreUpdate

- **WHEN** the user clicks Update on the `pi (core agent)` Core row
- **THEN** the component invokes `operations.coreUpdate("pi")`
- **AND** the queue subsequently POSTs `/api/pi-core/update` with `{packages: ["pi"]}`

#### Scenario: Core row reads busy from runningSource

- **WHEN** the queue's `runningSource` is `"pi-core:pi"`
- **THEN** the `pi (core agent)` row renders `busy = true` and shows the in-flight progress message

#### Scenario: Core row reads error from queue's per-source map

- **WHEN** a pi-core update for `pi` fails and the queue records `errorBySource.set("pi-core:pi", { message: "..." })`
- **THEN** the `pi (core agent)` row renders the error text underneath
- **AND** the row's Update button is enabled again (the error is sticky until the next enqueue, matching today's behavior)

#### Scenario: Update All produces serialized per-row state

- **GIVEN** the user clicks Update All with 3 updatable Core packages
- **THEN** the first row enters the `running` state
- **AND** the other two rows enter the `queued` state
- **WHEN** each row's update completes, the next row transitions from `queued` to `running` automatically
