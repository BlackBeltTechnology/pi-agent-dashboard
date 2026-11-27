## MODIFIED Requirements

### Requirement: One channel per bound workspace
The layer SHALL provision at most one text channel per bound workspace and SHALL maintain the binding across dashboard restarts. The channel SHALL be provisioned in the server named by the binding's `guildId`. It SHALL be provisioned only when that server is enabled, in `interactive` mode, and has provisioning enabled; otherwise the failure SHALL be reported with a specific reason.

#### Scenario: Workspace bound for the first time
- **WHEN** an operator binds a workspace
- **THEN** a channel is provisioned for it and the binding is persisted

#### Scenario: Dashboard restarts
- **WHEN** the dashboard restarts with existing bindings
- **THEN** the layer reattaches to the same channels without provisioning duplicates

#### Scenario: Binding targets a query server
- **WHEN** a binding names a server in `query` mode or with provisioning disabled
- **THEN** no channel is created and health reports `provisioning_guild_not_enabled`

#### Scenario: Binding without a server
- **WHEN** a binding has no `guildId` after adoption
- **THEN** no channel is created and health reports `provisioning_requires_guild_id`

### Requirement: Channel visibility is reconciled when the mapping changes
When a binding's principals or role mappings change, the layer SHALL reconcile the channel's permission overwrites so access matches the current mapping, without recreating the channel. Reconciliation SHALL be synchronous with the configuration write: the write SHALL NOT be reported as succeeded until the platform's overwrites match the new mapping, so no interval exists in which a removed principal retains view access. Where reconciliation fails, the configuration write SHALL fail and report the reason rather than leaving access in place. Reconciliation SHALL also run when the layer activates, so a change made while the dashboard was down takes effect. Where the binding's server is not enabled, `interactive` and provisioning-enabled, the layer SHALL make no platform call, so a write that changes the mapping of a binding with an active provisioned channel there SHALL fail with `access_unreconciled` and change nothing.

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

#### Scenario: Principal removed from a binding in a query server
- **WHEN** an operator removes a principal from a binding whose provisioned channel lives in a server that is in `query` mode, disabled, or without provisioning
- **THEN** the write is refused with `access_unreconciled`, the stored mapping is unchanged, and no permission call is made in that server

#### Scenario: Unrelated write in a query server
- **WHEN** an operator edits something that does not change the access mapping of any binding while one binding's server is in `query` mode
- **THEN** the write succeeds and that binding is only reported as skipped
