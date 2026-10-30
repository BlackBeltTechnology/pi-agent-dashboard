## MODIFIED Requirements

### Requirement: Flow actions and the FLOWS subcard are gated separately

The flows plugin SHALL use two gates:
- **Actions gate.** Its `session-card-action-bar` claim, which renders Run Flow…, Open flow…, New / Edit… and Delete in the session actions menu, SHALL be gated by flows availability. Flows is available when the pi-flows extension is active in the session's cwd, detected by a command named `flows` or starting with `flows:` in the session's `commandsList`, OR when the session has any flow event (live or replayed). It SHALL NOT gate on `flowsList` length, so a cwd where pi-flows is active but no flows are authored yet still offers New / Edit… when the session's effective edit mode is on. The removed `flows:new` command SHALL NOT be used as a signal.
- **Subcard gate.** The `session-card-flows` claim (the FLOWS subcard, now carrying flow status only) SHALL render only when the session has any flow event (live or replayed).

The availability cache SHALL remain closed by default (unavailable until the first `commandsList` publish for the session) and SHALL recompute on `commandsList` / `flowsList` publishes.

The action-bar claim SHALL NOT send any edit-mode message when it mounts, when flows becomes available, or when it re-renders. Edit mode reaches a session only through the explicit per-project action (see `flows-edit-mode-settings`).

#### Scenario: Active-but-empty flows cwd offers authoring in the menu
- **WHEN** a session's `commandsList` contains `flows`, its `flowsList` is empty, the session's effective edit mode is on, and it has no flow events
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
- **THEN** no `flow_management` `set-edit-mode` message SHALL be sent for that session (the reconcile is removed; this scenario name is kept for delta continuity)
