## MODIFIED Requirements

### Requirement: Refresh button in session header

A refresh icon button SHALL be displayed in the session header, re-fetching all events for the current session when activated. Refreshing SHALL also restore any prompt the session is still awaiting an answer for, so the refresh affordance repairs a chat view that is missing a blocking dialog. The restored prompt SHALL survive the state reset that refreshing performs.

#### Scenario: Desktop refresh button visible
- **WHEN** a session is selected on desktop
- **THEN** a refresh icon button appears in the session header after the duration badge

#### Scenario: Click refresh clears and re-subscribes
- **WHEN** the user clicks the refresh button
- **THEN** the local session state is reset to initial state
- **AND** a subscribe message with `lastSeq: 0` is sent to the server
- **AND** the chat view repopulates with replayed events

#### Scenario: Refresh restores an unanswered prompt
- **GIVEN** a session is blocked on an unanswered prompt that the chat view does not render
- **WHEN** the user clicks the refresh button
- **THEN** a pending-prompt resync SHALL be requested for that session
- **AND** the dialog SHALL be rendered once the prompt is re-emitted
- **AND** the dialog SHALL NOT be erased by the replay the refresh triggered

#### Scenario: Resync failure does not break the refresh
- **WHEN** the pending-prompt resync cannot be delivered
- **THEN** the transcript refresh SHALL still complete normally

#### Scenario: Loading indicator while refreshing
- **WHEN** the refresh button is clicked
- **THEN** the icon spins briefly to indicate loading

#### Scenario: Mobile refresh via action menu
- **WHEN** a session is selected on mobile
- **THEN** a "Refresh Chat" option appears in the MobileActionMenu
- **AND** clicking it triggers the same refresh behavior
