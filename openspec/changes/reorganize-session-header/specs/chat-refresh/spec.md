## MODIFIED Requirements

### Requirement: Refresh button in session header

A "Reload transcript" item SHALL be available in the session header title menu on desktop, re-fetching all events for the current session when activated. The item SHALL keep `data-testid="refresh-chat"`, use the `mdiHistory` icon, and carry the one-line description "Re-fetch every event from the server. Use it when the chat looks stale." The header SHALL NOT render a standalone refresh button. Reloading SHALL also restore any prompt the session is still awaiting an answer for, so the affordance repairs a chat view that is missing a blocking dialog. The restored prompt SHALL survive the state reset that reloading performs.

#### Scenario: Desktop refresh button visible
- **WHEN** a session is selected on desktop and the title menu is open
- **THEN** a "Reload transcript" item with `data-testid="refresh-chat"` is present in the title menu
- **AND** no standalone refresh button renders in the session header

#### Scenario: Click refresh clears and re-subscribes
- **WHEN** the user activates the "Reload transcript" item
- **THEN** the local session state is reset to initial state
- **AND** a subscribe message with `lastSeq: 0` is sent to the server
- **AND** the chat view repopulates with replayed events

#### Scenario: Refresh restores an unanswered prompt
- **GIVEN** a session is blocked on an unanswered prompt that the chat view does not render
- **WHEN** the user activates the "Reload transcript" item
- **THEN** a pending-prompt resync SHALL be requested for that session
- **AND** the dialog SHALL be rendered once the prompt is re-emitted
- **AND** the dialog SHALL NOT be erased by the replay the refresh triggered

#### Scenario: Resync failure does not break the refresh
- **WHEN** the pending-prompt resync cannot be delivered
- **THEN** the transcript refresh SHALL still complete normally

#### Scenario: Loading indicator while refreshing
- **WHEN** the user activates the "Reload transcript" item
- **THEN** the title menu closes
- **AND** the transcript shows its existing loading state until the replayed events arrive

#### Scenario: Mobile refresh via action menu
- **WHEN** a session is selected on mobile
- **THEN** a "Reload transcript" option with the `mdiHistory` icon appears in the MobileActionMenu
- **AND** clicking it triggers the same refresh behavior
