## Purpose

Maps dashboard workspaces onto Discord channels and sessions onto threads, so that a channel is both a conversation surface and a hard scope boundary limiting which working directories a command can ever reach.

## ADDED Requirements

### Requirement: One channel per workspace
The plugin SHALL create at most one Discord text channel per bound dashboard workspace and SHALL maintain the binding across dashboard restarts.

#### Scenario: Workspace bound for the first time
- **WHEN** an operator binds a workspace
- **THEN** a channel is created for it and the binding is persisted

#### Scenario: Dashboard restarts
- **WHEN** the dashboard restarts with existing bindings
- **THEN** the plugin reattaches to the same channels and threads without creating duplicates

### Requirement: Channel created private in a single operation
When creating a channel, the plugin SHALL supply its permission overwrites in the same creation request, denying view access to the guild-default role and granting it only to the principals and roles mapped to that workspace. The plugin SHALL NOT create a channel and then adjust its permissions afterwards.

#### Scenario: Auto-created channel visibility
- **WHEN** the plugin auto-creates a channel for a workspace
- **THEN** at no point in time is that channel viewable by the guild-default role

#### Scenario: Creation without permission to set overwrites
- **WHEN** the bot lacks the permission required to create a channel with overwrites
- **THEN** no channel is created and the failure is reported in the plugin's health entry

### Requirement: Channel lifecycle follows workspace, deletion never propagates
The plugin SHALL rename a bound channel when its workspace is renamed. The plugin SHALL NOT delete a channel when its workspace is deleted or unbound; it SHALL mark the binding inactive instead.

#### Scenario: Workspace renamed
- **WHEN** a workspace's name changes in the dashboard
- **THEN** the bound channel is renamed to match

#### Scenario: Workspace deleted
- **WHEN** a bound workspace is deleted
- **THEN** the channel and its history remain in the guild
- **AND** the binding becomes inactive, so no further mirroring or commands occur there

### Requirement: One thread per session
Each session surfaced into Discord SHALL be bound to exactly one thread within its workspace's channel.

#### Scenario: Session appears
- **WHEN** a session is created in a directory belonging to a bound workspace
- **THEN** a thread is created for it and the session↔thread binding is persisted

### Requirement: Threads outlive sessions
The plugin SHALL NOT delete or archive-and-discard a thread when its session ends, and SHALL NOT terminate a session when its thread is deleted or archived in Discord.

#### Scenario: Session ends
- **WHEN** a bound session reaches a terminal state
- **THEN** the thread remains, showing the session as ended

#### Scenario: Thread deleted in Discord
- **WHEN** a user deletes a bound thread
- **THEN** the session continues running unaffected
- **AND** the binding is dropped without further mirroring

### Requirement: Message in an ended session's thread offers resume
When an actionable message arrives in a thread whose session has ended, the plugin SHALL offer to resume that session rather than silently creating a new one.

#### Scenario: Prompt sent to a dead thread
- **WHEN** a `control` principal sends text in a thread whose session has ended
- **THEN** the plugin responds with a resume affordance and sends no prompt until it is accepted

### Requirement: Channel scope containment
A command or prompt originating in a bound channel or its threads SHALL only be able to affect sessions whose working directory lies within that channel's bound workspace. The target SHALL be derived from the binding; a working directory supplied as free text SHALL NOT be accepted.

#### Scenario: Cross-workspace targeting attempt
- **WHEN** a principal in one workspace's channel references a session belonging to a different workspace
- **THEN** the plugin refuses and performs no action on the referenced session

#### Scenario: Session's directory outside every binding
- **WHEN** a session's working directory belongs to no bound workspace
- **THEN** no thread is created and the session is not surfaced into Discord

### Requirement: Channel-level text does not spawn or prompt
Plain text posted in a bound channel outside any thread SHALL NOT be treated as a prompt and SHALL NOT create a session.

#### Scenario: Conversation in the channel body
- **WHEN** principals discuss work in the channel itself rather than in a thread
- **THEN** no prompt is delivered and no session is created
