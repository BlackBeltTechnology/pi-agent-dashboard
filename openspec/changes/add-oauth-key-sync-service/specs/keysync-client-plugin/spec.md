## ADDED Requirements

### Requirement: The client handles no provider credentials outside enrolment
The client plugin SHALL NOT store, cache, or write any pooled provider credential, and SHALL NOT perform account selection or rotation. Enrolment is the sole exception and is bounded: a credential the member is themselves capturing exists transiently in the scratch directory and in the upload, and never persists afterwards. The plugin SHALL never hold a credential belonging to another member.

#### Scenario: No credential written locally
- **WHEN** a member uses keysync for an entire session without enrolling
- **THEN** no pooled provider credential is present anywhere on the member's filesystem

#### Scenario: A captured credential does not survive enrolment
- **WHEN** a member completes an enrolment
- **THEN** the captured credential exists nowhere on their filesystem once the flow ends, on both the success and failure paths

#### Scenario: A teammate's credential never reaches the client
- **WHEN** a member views pool state containing accounts owned by others
- **THEN** the response carries status and identity only, and no token material for any account

### Requirement: The client authenticates to management routes as a member identity
Management operations (enrolment upload, visibility, primary, rotation preference, pool display) SHALL be authenticated by a member identity session, and SHALL NOT accept a proxy key. The mechanism by which a pi-session plugin obtains that session is unresolved (design open questions) and SHALL be settled before the client is implemented.

#### Scenario: A proxy key is refused on a management route
- **WHEN** a caller presents a keysync proxy key to a management route
- **THEN** the request is rejected — proxy keys authenticate model traffic only, and accepting them here would let any machine key mutate pool configuration

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

#### Scenario: Routability is served by keysync itself
- **WHEN** the plugin needs to know which models pooled OAuth cannot route
- **THEN** it obtains that from keysync, which owns the answer because it owns the credentials — the dashboard's `oauth-compat.ts` table cannot be imported by a standalone service and the dashboard may not be running at all
