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

A session with a pending agent file-access prompt (the agent path-gate prompt
or its always-allow confirmation) SHALL count as blocked-on-you for this rollup
and for the urgency sort for as long as that prompt is pending, even though the
gated `read`, `write` or `edit` tool is in flight. Counting it SHALL NOT change
the session's displayed in-flight tool, and SHALL survive a reconnect of the
session's bridge while the prompt is still pending. Agent file-access prompts
are always chat-placed, so the widget-bar exclusion never applies to them. Other
prompts SHALL keep the existing precedence, under which an in-flight tool hides
the `ask_user` state.

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

#### Scenario: A file-access prompt during a tool counts as blocked

- **GIVEN** a session whose in-flight tool is `read`
- **WHEN** the agent path gate raises a file-access prompt for that read
- **THEN** the session SHALL count toward the needs-you rollup

#### Scenario: Settling stops counting without touching the tool display

- **GIVEN** a session counted as needs-you because of a pending file-access prompt for an in-flight `read`
- **WHEN** the operator answers `Allow once`
- **THEN** the session SHALL no longer count toward the rollup
- **AND** the session's displayed in-flight tool SHALL have remained `read` throughout

#### Scenario: Reconnect keeps the count

- **GIVEN** a session counted as needs-you because of a pending file-access prompt
- **WHEN** the session's bridge disconnects and reconnects with the prompt still pending
- **THEN** the session SHALL count toward the rollup after the reconnect

#### Scenario: A sibling tool start does not clear the count

- **GIVEN** a session counted as needs-you because of a pending file-access prompt
- **WHEN** another tool of the same session starts executing
- **THEN** the session SHALL still count toward the rollup until the prompt settles

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

### Requirement: Waiting file-access prompts are announced without a modal

When an agent file-access prompt is first shown and the operator is not viewing
that session, the dashboard SHALL show a non-modal notification naming the
session and offering to open it. The notification SHALL NOT block interaction
with the current view and SHALL be removed when the prompt is answered,
withdrawn or times out.

#### Scenario: Toast when viewing another session

- **GIVEN** the operator is viewing session B
- **WHEN** session A raises an agent file-access prompt
- **THEN** a non-modal notification SHALL name session A and offer to open it

#### Scenario: No toast when already viewing the session

- **GIVEN** the operator is viewing session A
- **WHEN** session A raises an agent file-access prompt
- **THEN** no notification SHALL be shown

#### Scenario: Notification clears on settlement

- **WHEN** the prompt is answered in any surface or times out
- **THEN** the notification SHALL be removed
