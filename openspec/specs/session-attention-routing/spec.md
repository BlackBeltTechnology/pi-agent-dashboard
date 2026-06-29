# session-attention-routing Specification

## Purpose
TBD - created by archiving change improve-dashboard-attention-routing. Update Purpose after archive.
## Requirements
### Requirement: Folder header shows a needs-you rollup

Each folder header SHALL display a compact, clickable "needs-you" affordance
showing the count of that folder's child sessions in the chat-routed `ask_user`
(blocked-on-you) state. The affordance SHALL be hidden when the count is 0.
Activating it SHALL bring the blocked sessions into view (scroll to and/or
filter them). The count SHALL exclude sessions whose pending prompt is
widget-bar-placed.

#### Scenario: Rollup hidden when none blocked

- **WHEN** a folder has zero child sessions in chat-routed `ask_user` state
- **THEN** the needs-you rollup SHALL NOT render

#### Scenario: Rollup shows count and is clickable

- **WHEN** a folder has 2 child sessions in chat-routed `ask_user` state
- **THEN** the rollup SHALL render with the count "2"
- **AND** activating it SHALL scroll to / filter the 2 blocked sessions

#### Scenario: Widget-bar prompts excluded from count

- **WHEN** a folder has 1 chat-routed and 1 widget-bar-placed `ask_user` session
- **THEN** the rollup count SHALL be "1"

### Requirement: Opt-in urgency sort floats blocked sessions to the top

A per-folder display preference (default OFF) SHALL, when enabled, sort
chat-routed `ask_user` sessions to the top of that folder's active-session list,
preserving stable relative order within each state group. When OFF, the existing
list order SHALL be unchanged. The preference SHALL persist via the existing
display-preferences mechanism.

#### Scenario: Sort off preserves existing order

- **WHEN** the per-folder urgency-sort preference is OFF
- **THEN** the active-session list order SHALL be unchanged from current behavior

#### Scenario: Sort on floats blocked to top

- **WHEN** the per-folder urgency-sort preference is ON
- **AND** the folder has blocked and non-blocked active sessions
- **THEN** all chat-routed `ask_user` sessions SHALL appear above non-blocked active sessions
- **AND** relative order within each group SHALL be stable

#### Scenario: Preference persists

- **WHEN** the user toggles urgency-sort and reloads
- **THEN** the toggle state SHALL be restored from persisted display preferences

