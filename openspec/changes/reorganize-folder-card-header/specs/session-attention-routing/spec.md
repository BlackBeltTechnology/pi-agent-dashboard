## MODIFIED Requirements

### Requirement: Folder header shows a needs-you rollup

Each folder header SHALL display a single status capsule that rolls up the states of that
folder's child sessions. The capsule SHALL include a "needs-you" segment showing the count
of child sessions in the chat-routed `ask_user` (blocked-on-you) state, excluding sessions
whose pending prompt is widget-bar-placed. The needs-you segment SHALL be hidden when that
count is 0.

The capsule SHALL replace the separate session-count label, the standalone needs-you pill,
and the collapsed-only status rollup. It SHALL render identically whether the folder is
collapsed or expanded.

Capsule segments SHALL be ordered by severity — needs-you, then error, then working, then
idle — and only the leading (most severe) segment SHALL be colour-tinted; the remaining
segments SHALL render as plain text. The trailing idle count SHALL never be tinted.

Each non-idle segment SHALL be an individually activatable control that brings that state's
sessions into view. The idle segment SHALL be inert.

#### Scenario: Rollup hidden when none blocked

- **WHEN** a folder has zero child sessions in chat-routed `ask_user` state
- **THEN** the needs-you segment SHALL NOT render

#### Scenario: Rollup shows count and is clickable

- **WHEN** a folder has 2 child sessions in chat-routed `ask_user` state
- **THEN** the needs-you segment SHALL render with the count "2"
- **AND** activating it SHALL scroll to / filter the 2 blocked sessions

#### Scenario: Widget-bar prompts excluded from count

- **WHEN** a folder has 1 chat-routed and 1 widget-bar-placed `ask_user` session
- **THEN** the needs-you segment count SHALL be "1"

#### Scenario: Capsule renders in both collapse states

- **GIVEN** a folder with blocked and working child sessions
- **WHEN** the folder is expanded
- **THEN** the capsule SHALL render with the same segments it shows when collapsed

#### Scenario: Blocked outranks error

- **GIVEN** a folder with 4 blocked sessions and 1 errored session
- **WHEN** the capsule renders
- **THEN** the needs-you segment SHALL be the leading segment and SHALL be tinted
- **AND** the error segment SHALL render after it as untinted text

#### Scenario: All-idle folder shows an uncoloured count

- **GIVEN** a folder whose child sessions are all idle
- **WHEN** the capsule renders
- **THEN** it SHALL show only the total count
- **AND** that count SHALL carry no status tint

#### Scenario: Segments activate independently

- **GIVEN** a capsule showing both a needs-you segment and a working segment
- **WHEN** the user activates the working segment
- **THEN** the first working session SHALL be brought into view
- **AND** the blocked sessions SHALL NOT be targeted
