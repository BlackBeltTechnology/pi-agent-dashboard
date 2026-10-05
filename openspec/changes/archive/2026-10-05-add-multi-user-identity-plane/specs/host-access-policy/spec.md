## Purpose

Adds a single, optional, host-owned, deny-by-default authorization gate that a trusted plugin MAY supply for **non-session** host-owned roads: domain-event fan-out, workspace/OpenSpec/branch/terminal/system bootstrap and commands, and disclosure of non-session bootstrap state. It is a host resource-dispatch gate, NOT the product authorization model, and NOT the gate for session roads (those are owner-gated per `session-ownership-scoping`). When no policy is registered, non-session roads stay ungated, exactly as before this change.

## ADDED Requirements

### Requirement: The host access policy is optional and non-session-scoped

The system SHALL allow at most one host access policy, registered only by the plugin named in `identity.trustedPolicyPlugin`. The policy SHALL govern only non-session host-owned roads. Session roads SHALL be governed by owner equality regardless of whether a policy is registered. When no `trustedPolicyPlugin` is named, non-session roads SHALL remain ungated (their behavior before this change).

#### Scenario: No policy means non-session roads are ungated
- **WHEN** no `identity.trustedPolicyPlugin` is configured and the resolver is active
- **THEN** non-session host roads behave exactly as before this change
- **AND** session roads are still owner-gated

#### Scenario: Policy never gates a session road
- **WHEN** a policy is registered and a principal accesses a session it owns
- **THEN** access is decided by owner equality, not by the policy

### Requirement: Policy readiness is validated before listen

When `identity.trustedPolicyPlugin` is named, the system SHALL verify before `listen()` that exactly one policy from that plugin is registered. A named-but-absent policy or a duplicate registration SHALL keep identity from being enforced — the plane stays inert — and SHALL NOT abort startup, because a server that refuses to start is itself a lockout (design D21). The server SHALL log, before listening, that identity is NOT enforced and name the policy-count mismatch. An unnamed policy (the default) SHALL be valid.

#### Scenario: Named-but-absent policy disarms identity instead of failing startup
- **WHEN** `identity.trustedPolicyPlugin` names a plugin that registers no policy
- **THEN** startup succeeds, identity is not enforced, and the server logs the named-but-absent policy before listening

#### Scenario: Duplicate policy disarms identity rather than choosing one
- **WHEN** two registrations of the access policy are attempted
- **THEN** no policy is chosen nondeterministically, identity is not enforced, and the server logs the mismatch; startup still succeeds

### Requirement: Single host access policy contract

When registered, the policy SHALL be exactly one `authorize({ principal, action, resource }) => Promise<boolean>` from the plugin named by `identity.trustedPolicyPlugin`. The host SHALL call it to decide a non-session road. `action` values SHALL be stable host constants; `resource` SHALL be bounded plain data identifying the target without secrets.

#### Scenario: Only the named plugin can register the policy
- **WHEN** a plugin not named in `identity.trustedPolicyPlugin` attempts to register a policy
- **THEN** the registration is refused

#### Scenario: Policy decides a non-session road
- **WHEN** a non-session road is reached with a principal and a policy is registered
- **THEN** the host calls `authorize` and proceeds only on `true`

### Requirement: Bounded, fail-closed policy evaluation

The system SHALL bound each policy call by a configured timeout (default 500 ms, range 50–2000 ms). When a policy is registered, a `false`, throw, timeout, or non-boolean result SHALL deny access and emit a structured audit event naming principal, action, resource, and reason.

#### Scenario: Policy timeout denies
- **WHEN** a registered policy does not resolve within the timeout
- **THEN** access is denied and an audit event is logged

#### Scenario: Non-boolean result denies
- **WHEN** a registered policy resolves a non-boolean value
- **THEN** access is denied

### Requirement: Non-session road classification drives the policy

Every non-session host road (workspace/OpenSpec/branch/terminal/system HTTP routes and commands, and domain events) SHALL carry `{ action, resource }` classification. When a policy is registered, a non-session road that reaches the policy path without a classification SHALL deny fail-closed. When no policy is registered, classification is inert and the road is ungated. Session roads SHALL instead be classified for owner equality (see `session-ownership-scoping`); coverage of the session-road set SHALL be asserted so a new session road without owner equality fails.

#### Scenario: Unclassified non-session road denies when a policy is present
- **WHEN** a policy is registered and a non-session road on the policy path carries no classification
- **THEN** it is denied rather than allowed

#### Scenario: Classification is inert without a policy
- **WHEN** no policy is registered
- **THEN** a non-session road runs as before this change regardless of classification

#### Scenario: Session-road coverage is enforced by test
- **WHEN** a new session road is added without an owner-equality check
- **THEN** the session-road coverage test fails

### Requirement: Bootstrap disclosure is gated for non-session state

When a policy is registered, the system SHALL authorize WebSocket bootstrap disclosure of non-session state (OpenSpec, branch/HEAD, terminal, workspace) through the access policy, so connection bootstrap does not disclose non-session state the policy forbids. Session snapshots in bootstrap SHALL be owner-filtered regardless of the policy. When no policy is registered, non-session bootstrap disclosure is unchanged.

#### Scenario: Bootstrap omits policy-forbidden non-session state
- **WHEN** a principal connects with a policy registered
- **THEN** the bootstrap includes only workspace/terminal/system state the policy permits
- **AND** it includes only sessions the principal owns, independent of the policy

#### Scenario: Global command is policy-gated when a policy is present
- **WHEN** a principal issues a workspace or terminal command with a policy registered
- **THEN** the host calls the policy and proceeds only on `true`
