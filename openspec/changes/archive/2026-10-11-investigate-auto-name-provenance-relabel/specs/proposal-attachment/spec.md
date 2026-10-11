## MODIFIED Requirements

### Requirement: Manual detach via browser
The browser SHALL send a `detach_proposal` message to clear the attached proposal. The server SHALL set `session.attachedProposal` to null, clear `openspecPhase` and `openspecChange` to null, and broadcast a `session_updated` message. The session name SHALL be reverted only when it was auto-set by the attach (it equals the attached proposal) and the session's `nameSource` is not `"user"`; otherwise it SHALL remain unchanged.

#### Scenario: User clicks Detach
- **WHEN** the user clicks the "Detach" button on session `"s1"`
- **THEN** the browser SHALL send `{ type: "detach_proposal", sessionId: "s1" }`
- **AND** the server SHALL set `session.attachedProposal = null`, `session.openspecPhase = null`, `session.openspecChange = null` and broadcast the update
- **AND** the session name SHALL remain unchanged unless it was auto-set by the attach and is not user-owned

#### Scenario: Re-detection after detach
- **WHEN** a proposal is detached from a session
- **AND** the session later receives new `openspec_activity_update` messages with both phase and changeName
- **THEN** the server SHALL auto-attach the newly detected change

## ADDED Requirements

### Requirement: Attach auto-names the session and detach reverts it
When a proposal is attached (manually or automatically) and the session's `name` field is empty/undefined, the server SHALL set `session.name` to the proposal name, record `nameSource = "system"`, and send a `rename_session` message tagged with `system` origin to the extension so pi's internal session name is updated. On detach, a name auto-set by the attach SHALL be reverted unless the session's `nameSource` is `"user"`.

#### Scenario: Auto-name on attach when name is empty
- **WHEN** a proposal `"add-auth"` is attached to a session with `name = undefined`
- **THEN** the server SHALL set `session.name = "add-auth"`, record `nameSource = "system"`, and send `rename_session` with `system` origin to the extension

#### Scenario: No auto-name when name already set
- **WHEN** a proposal `"add-auth"` is attached to a session with `name = "my custom name"`
- **THEN** the server SHALL NOT change `session.name`

#### Scenario: Detach reverts an attach-set name
- **WHEN** a proposal is detached from a session whose name was auto-set to the proposal name and whose `nameSource` is not `"user"`
- **THEN** the session name SHALL be cleared, `nameSource` and its witness SHALL be cleared, and `rename_session` with an empty name and `system` origin SHALL be sent

#### Scenario: Detach keeps a user-owned name equal to the proposal
- **WHEN** a proposal is detached from a session whose name equals the attached proposal but whose `nameSource` is `"user"`
- **THEN** the session name SHALL NOT be changed

## REMOVED Requirements

### Requirement: Auto-name session on attach
**Reason**: Its "Detach does not revert name" scenario contradicts shipped behaviour (`detachShouldClearName`, `openspec-attach-combo` "Idempotent auto-rename revert on detach"). Replaced by "Attach auto-names the session and detach reverts it", which also records `system` provenance.
**Migration**: None — behaviour already shipped; the replacement requirement documents it.
