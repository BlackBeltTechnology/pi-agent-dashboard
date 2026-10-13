## MODIFIED Requirements

### Requirement: Commands state in App
The App component SHALL store per-session commands in a `Map<string, CommandInfo[]>` keyed by session ID. When a `commands_list` message is received from the server, the commands for that session SHALL be updated. The active session's commands SHALL be passed to the `CommandInput` component. When the active session is ended and no `commands_list` has been received for it, the folder command list for the session's cwd SHALL be passed instead.

#### Scenario: Commands received for session
- **WHEN** the server sends a `commands_list` message for session "abc-123"
- **THEN** the App SHALL store the commands and pass them to `CommandInput` when session "abc-123" is selected

#### Scenario: Switch sessions
- **WHEN** the user switches from session A to session B
- **THEN** the `CommandInput` SHALL receive session B's commands for autocomplete

#### Scenario: No commands received yet
- **WHEN** a live session is selected but no `commands_list` has been received
- **THEN** the `CommandInput` SHALL receive an empty commands array

#### Scenario: Ended session without commands uses the folder list
- **WHEN** an ended session is selected and no `commands_list` has been received for it
- **THEN** the `CommandInput` SHALL receive the folder command list for the session's cwd, or an empty array when that list is empty or unavailable
