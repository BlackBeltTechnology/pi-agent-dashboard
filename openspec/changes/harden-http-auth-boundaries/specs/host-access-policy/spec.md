## MODIFIED Requirements

### Requirement: The host access policy is optional and non-session-scoped

The system SHALL allow at most one host access policy, registered only by the plugin named in `identity.trustedPolicyPlugin`. The policy SHALL govern only non-session host-owned roads. Session roads SHALL be governed by owner equality regardless of whether a policy is registered. When no `trustedPolicyPlugin` is named, no policy SHALL gate non-session roads, and a claimed principal SHALL instead be tier-capped (see "A principal without a host policy is tier-capped"); callers that are not principals SHALL be unchanged.

#### Scenario: No policy means non-session roads are ungated
- **WHEN** no `identity.trustedPolicyPlugin` is configured and the resolver is active
- **THEN** no policy gates non-session host roads, and a claimed principal is limited to `identity.defaultPrincipalTier`
- **AND** session roads are still owner-gated

#### Scenario: Policy never gates a session road
- **WHEN** a policy is registered and a principal accesses a session it owns
- **THEN** access is decided by owner equality, not by the policy

### Requirement: Non-session road classification drives the policy

Every non-session host road (workspace/OpenSpec/branch/terminal/system HTTP routes and commands, and domain events) SHALL carry `{ action, resource }` classification. When a policy is registered, a non-session road that reaches the policy path without a classification SHALL deny fail-closed. When no policy is registered, classification is inert and the principal tier cap decides instead. Session roads SHALL instead be classified for owner equality (see `session-ownership-scoping`); coverage of the session-road set SHALL be asserted so a new session road without owner equality fails.

#### Scenario: Unclassified non-session road denies when a policy is present
- **WHEN** a policy is registered and a non-session road on the policy path carries no classification
- **THEN** it is denied rather than allowed

#### Scenario: Classification is inert without a policy
- **WHEN** no policy is registered
- **THEN** the policy path is not consulted regardless of classification, and the principal tier cap decides

#### Scenario: Session-road coverage is enforced by test
- **WHEN** a new session road is added without an owner-equality check
- **THEN** the session-road coverage test fails


## ADDED Requirements

### Requirement: A principal without a host policy is tier-capped
While identity is enforced and no host policy is registered, every claimed principal other than the break-glass local operator SHALL be a tiered credential at `identity.defaultPrincipalTier` (`observe`, `control` or `operate`; default `control`; any other value reads as `control`). With a policy registered the policy alone decides and no cap applies.

#### Scenario: Principal can drive its sessions but not administer
- **GIVEN** identity enforced, no host policy, default config
- **WHEN** a principal calls `POST /api/session/spawn` and then `PUT /api/config`
- **THEN** the spawn SHALL proceed and the config write SHALL be refused with 403 `insufficient_scope`

#### Scenario: Explicit operate restores today's reach
- **GIVEN** `identity.defaultPrincipalTier: "operate"`
- **WHEN** the principal calls `PUT /api/config`
- **THEN** it SHALL be admitted, and one boot line SHALL have named the setting

#### Scenario: Invalid value falls back to control
- **WHEN** `identity.defaultPrincipalTier` is `"admin"`
- **THEN** the effective cap SHALL be `control`

#### Scenario: A registered policy replaces the cap
- **GIVEN** identity enforced and a host policy registered
- **WHEN** a principal calls a non-session road
- **THEN** the policy SHALL decide and no tier cap SHALL apply

#### Scenario: Break-glass local operator is not capped
- **GIVEN** identity enforced and no host policy
- **WHEN** a request carries a live host-issued operator bearer
- **THEN** it SHALL be admitted as before

### Requirement: The principal tier cap applies on every road
The cap SHALL gate REST routes through the route-tier gate, browser WebSocket messages through the socket tier, and ticket minting per scope (`browser`/`live` `control`, `terminal`/`bridge` `operate`); `operate`-gated routes that accept a principal, such as services mutations, SHALL require a principal whose tier is `operate`.

#### Scenario: Principal cannot open a terminal
- **GIVEN** identity enforced, no host policy, default config
- **WHEN** the principal requests a `terminal` ticket from `POST /api/ws-ticket`
- **THEN** the server SHALL respond 403 `insufficient_scope` with `scope="operate"` and mint nothing

#### Scenario: Capped principal can still open the browser socket
- **GIVEN** the same state with a `control` cap
- **WHEN** the principal mints a `browser` ticket and opens `/ws`
- **THEN** the ticket SHALL be minted and the socket SHALL carry tier `control`

#### Scenario: Browser socket of a capped principal drops above-tier messages
- **GIVEN** the same state with a `control` cap
- **WHEN** the principal's `/ws` socket sends an `operate`-tier message
- **THEN** the message SHALL be dropped and one `auth.tier_refused` line logged

#### Scenario: Observe cap opens no socket
- **GIVEN** the same state with `identity.defaultPrincipalTier: "observe"`
- **WHEN** the principal requests a `browser` ticket
- **THEN** the server SHALL respond 403 `insufficient_scope` and the principal SHALL read through REST only

#### Scenario: Services no longer treat a capped principal as operate
- **GIVEN** the same state and a `control` cap
- **WHEN** the principal calls a services mutation route
- **THEN** the route-tier gate SHALL refuse it with 403 `insufficient_scope` (`scope="operate"`) before the handler runs

