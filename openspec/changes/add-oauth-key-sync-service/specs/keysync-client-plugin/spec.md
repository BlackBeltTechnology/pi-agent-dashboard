## ADDED Requirements

### Requirement: The client handles no provider credentials
The client plugin SHALL NOT store, cache, or write any pooled provider credential, and SHALL NOT perform account selection or rotation.

#### Scenario: No credential written locally
- **WHEN** a member uses keysync for an entire session
- **THEN** no pooled provider credential is present anywhere on the member's filesystem

### Requirement: The client configures pi to reach keysync
The plugin SHALL write the local provider configuration directing pi at the keysync endpoint with the member's key, and SHALL leave unrelated provider entries unchanged.

#### Scenario: Unrelated providers preserved
- **WHEN** the plugin writes the keysync provider configuration
- **THEN** provider entries the member configured for other purposes are unchanged

#### Scenario: Removal restores direct operation
- **WHEN** the plugin is removed and the member restores a direct provider entry
- **THEN** pi operates normally against the provider without keysync

### Requirement: Pool state is displayed to the member
The plugin SHALL display each account in the member's pool with its owner, visibility, health state, and which account is currently preferred.

#### Scenario: Cooling account shows its remaining time
- **WHEN** an account in the member's pool is `cooling`
- **THEN** the display shows the remaining cooldown rather than an unqualified unavailable state

#### Scenario: Inert rotation control is not shown as live
- **WHEN** the admin has globally disabled rotation
- **THEN** the member's rotation control is shown as inactive with the reason, rather than as an enabled setting

### Requirement: Models unroutable over OAuth are surfaced
The plugin SHALL indicate models that cannot be served by pooled OAuth accounts, rather than allowing selection that fails opaquely at request time.

#### Scenario: Unroutable model is marked
- **WHEN** a model is known to be unreachable using OAuth credentials
- **THEN** the plugin marks it as unavailable through keysync with the reason
