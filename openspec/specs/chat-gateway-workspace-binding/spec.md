# chat-gateway-workspace-binding Specification

## Purpose
Makes a dashboard workspace — a named set of folders a team already thinks in — the unit a chat channel binds to, and guarantees the channel is private from the moment it exists. The binding is also the scope boundary that limits which working directories a command can ever reach.

Channel→session routing and per-thread session granularity are the gateway's; this capability covers the workspace↔channel layer above them.

## Requirements

### Requirement: One channel per bound workspace
The layer SHALL provision at most one text channel per bound workspace and SHALL maintain the binding across dashboard restarts.

#### Scenario: Workspace bound for the first time
- **WHEN** an operator binds a workspace
- **THEN** a channel is provisioned for it and the binding is persisted

#### Scenario: Dashboard restarts
- **WHEN** the dashboard restarts with existing bindings
- **THEN** the layer reattaches to the same channels without provisioning duplicates

### Requirement: Channel provisioned private in a single operation
When provisioning a channel, the layer SHALL supply its permission overwrites in the same creation request, denying view access to the platform-default role and granting it only to the principals and roles mapped to that binding. The layer SHALL NOT create a channel and then adjust its permissions afterwards.

#### Scenario: Provisioned channel visibility
- **WHEN** the layer provisions a channel for a workspace
- **THEN** at no point in time is that channel viewable by the platform-default role

#### Scenario: Provisioning without permission to set overwrites
- **WHEN** the bot lacks the permission required to create a channel with overwrites
- **THEN** no channel is created and the failure is reported in the plugin's health entry

### Requirement: Channel visibility is reconciled when the mapping changes
When a binding's principals or role mappings change, the layer SHALL reconcile the channel's permission overwrites so access matches the current mapping, without recreating the channel. Reconciliation SHALL be synchronous with the configuration write: the write SHALL NOT be reported as succeeded until the platform's overwrites match the new mapping, so no interval exists in which a removed principal retains view access. Where reconciliation fails, the configuration write SHALL fail and report the reason rather than leaving access in place. Reconciliation SHALL also run when the layer activates, so a change made while the dashboard was down takes effect.

#### Scenario: Principal removed from a binding
- **WHEN** an operator removes a principal from a binding
- **THEN** at the moment the write is reported as succeeded, that principal already has no view access to the bound channel

#### Scenario: Reconciliation fails
- **WHEN** the platform rejects the overwrite update during a mapping change
- **THEN** the configuration write fails and reports the reason
- **AND** the stored mapping and the channel's access remain consistent with each other

#### Scenario: Principal added to a binding
- **WHEN** an operator adds a principal to a binding
- **THEN** that principal gains view access without the channel being recreated

#### Scenario: Mapping changed while the dashboard was down
- **WHEN** the layer activates after a mapping change it did not observe
- **THEN** it reconciles the channel's overwrites to match the current mapping

### Requirement: Channel lifecycle follows workspace, deletion never propagates
The layer SHALL rename a bound channel when its workspace is renamed. The layer SHALL NOT delete a channel when its workspace is deleted or unbound; it SHALL mark the binding inactive instead. The layer SHALL NOT mutate a workspace.

#### Scenario: Workspace renamed
- **WHEN** a workspace's name changes in the dashboard
- **THEN** the bound channel is renamed to match

#### Scenario: Workspace deleted
- **WHEN** a bound workspace is deleted
- **THEN** the channel and its history remain on the platform
- **AND** the binding becomes inactive, so no further mirroring or commands occur there

#### Scenario: Channel deleted on the platform
- **WHEN** a bound channel is deleted in Discord
- **THEN** sessions continue running unaffected
- **AND** the binding is dropped without further mirroring

#### Scenario: Workspace-irrelevant change
- **WHEN** a workspace change that affects neither its name, its folders, nor its existence is observed
- **THEN** no platform call is made

### Requirement: Working directory resolves to at most one workspace
Resolution of a session's working directory to a bound workspace SHALL match only on whole path segments, SHALL resolve symbolic links before comparing, and SHALL select the most specific matching folder when several match.

#### Scenario: Sibling directory with a shared name prefix
- **WHEN** a workspace contains a folder and a session runs in a sibling directory whose name merely starts with that folder's name
- **THEN** the session does not resolve to that workspace

#### Scenario: Nested folders in different workspaces
- **WHEN** one bound workspace contains a parent directory and another contains a subdirectory of it, and a session runs in that subdirectory
- **THEN** the session resolves to the workspace containing the more specific folder

#### Scenario: Symlinked working directory
- **WHEN** a session's working directory is a symbolic link resolving inside a bound workspace's folder
- **THEN** the session resolves to that workspace

#### Scenario: Directory outside every binding
- **WHEN** a session's working directory belongs to no bound workspace
- **THEN** the session is not surfaced into any channel

### Requirement: Scope containment
A command or prompt originating in a bound channel or its threads SHALL only be able to affect sessions whose working directory lies within that channel's bound workspace. The target SHALL be derived from the binding; a working directory supplied as free text SHALL NOT be accepted.

#### Scenario: Cross-workspace targeting attempt
- **WHEN** a principal in one workspace's channel references a session belonging to a different workspace
- **THEN** the request is refused and no action is performed on the referenced session

#### Scenario: Free-text directory supplied
- **WHEN** a principal supplies a working directory as message text
- **THEN** it is not used to resolve a target
