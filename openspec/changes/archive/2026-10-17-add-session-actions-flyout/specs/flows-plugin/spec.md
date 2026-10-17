## ADDED Requirements

### Requirement: Flow actions and the FLOWS subcard are gated separately

The flows plugin SHALL use two gates:
- **Actions gate.** Its `session-card-action-bar` claim, which renders Run Flow…, Open flow…, New / Edit… and Delete in the session actions menu, SHALL be gated by flows availability. Flows is available when the pi-flows extension is active in the session's cwd, detected by a command named `flows` or starting with `flows:` in the session's `commandsList`, OR when the session has any flow event (live or replayed). It SHALL NOT gate on `flowsList` length, so a cwd where pi-flows is active but no flows are authored yet still offers New / Edit… in edit mode. The removed `flows:new` command SHALL NOT be used as a signal.
- **Subcard gate.** The `session-card-flows` claim (the FLOWS subcard, now carrying flow status only) SHALL render only when the session has any flow event (live or replayed).

The availability cache SHALL remain closed by default (unavailable until the first `commandsList` publish for the session) and SHALL recompute on `commandsList` / `flowsList` publishes.

The edit-mode reconcile, which pushes the global edit-flow default to the session once flows are available, SHALL run from the action-bar claim. That claim is mounted for the card's lifetime unless the per-plugin visibility filter hides the flows plugin, so the reconcile runs whether or not the FLOWS subcard or the menu is shown. When the filter hides the plugin, the reconcile does not run; the same holds for the FLOWS-subcard claim today.

#### Scenario: Active-but-empty flows cwd offers authoring in the menu
- **WHEN** a session's `commandsList` contains `flows`, its `flowsList` is empty, edit mode is on, and it has no flow events
- **THEN** the session actions menu SHALL offer **New / Edit…**
- **AND** no FLOWS subcard SHALL render

#### Scenario: A run shows the FLOWS subcard
- **WHEN** a session has any `flow_*` event (live or replayed)
- **THEN** the FLOWS subcard SHALL render its flow status

#### Scenario: No flows command and no events offers nothing
- **WHEN** a session has a non-empty `flowsList` but no `flows` / `flows:*` command and no flow event
- **THEN** no flow action SHALL appear in the menu and no FLOWS subcard SHALL render

#### Scenario: Closed by default before first publish
- **WHEN** no `commandsList` has been published for a session and it has no flow events
- **THEN** no flow action SHALL appear and no FLOWS subcard SHALL render

#### Scenario: Edit-mode reconcile runs without opening the menu
- **WHEN** flows becomes available for a session and the menu has never been opened
- **THEN** the edit-mode reconcile message SHALL be sent once for the current global default

## MODIFIED Requirements

### Requirement: Flow rendering is packaged as a workspace plugin
The dashboard SHALL ship flow rendering as a dedicated workspace package at `packages/flows-plugin/`. The package SHALL declare a `pi-dashboard-plugin` manifest field claiming the slots that mount its UI components, and SHALL expose its reducer logic via an `exports` map so that `packages/client/src/lib/event-reducer.ts` can import it as a workspace dependency.

#### Scenario: Workspace dependency wired
- **WHEN** the dashboard is built from a fresh checkout
- **THEN** `packages/client/package.json` SHALL list `@blackbelt-technology/pi-dashboard-flows-plugin` as a dependency
- **AND** `packages/flows-plugin/package.json` SHALL include a `pi-dashboard-plugin` manifest field
- **AND** the manifest SHALL claim at minimum: `session-card-flows` (flow status), `session-card-action-bar` (flow actions, rendered in the session actions menu), `content-header-sticky`, `content-view` (route `flow-agent-detail/:agentId`), `content-view` (route `architect-detail`)
- **AND** the manifest SHALL NOT claim `session-card-badge` (see `flows-running-status-pill`)

## REMOVED Requirements

### Requirement: FLOWS subcard availability is gated on extension presence, not flow count
**Reason**: The FLOWS subcard no longer carries the flow actions. Availability now gates the flows action-bar claim (menu actions), and the subcard shows only when there is flow activity to report.
**Migration**: See "Flow actions and the FLOWS subcard are gated separately". The same presence signal (a `flows` / `flows:*` command, or any flow event) gates the menu actions.
