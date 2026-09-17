## Purpose

Adds an explicit multi-user activation mode and a single, host-owned, deny-by-default authorization boundary that a trusted plugin supplies, covering every protected host-owned road: HTTP routes, WebSocket bootstrap frames, inbound WS commands, global/workspace/terminal/system resources, and domain-event fan-out.

## ADDED Requirements

### Requirement: Explicit identity mode

The system SHALL define `identity.mode: "legacy" | "multi-user"`, defaulting to `legacy`. In `legacy` mode all existing HTTP, ticket, upgrade, bootstrap, command, and broadcast outcomes SHALL be unchanged. In `multi-user` mode protected human-facing surfaces SHALL be authorized and fail-closed.

#### Scenario: Default is legacy and unchanged
- **WHEN** no `identity` configuration is present
- **THEN** the system runs in legacy mode with behavior identical to before this change

#### Scenario: Multi-user mode enforces
- **WHEN** `identity.mode` is multi-user
- **THEN** protected roads require a principal and a policy decision

### Requirement: Multi-user readiness is validated before listen

When `identity.mode = multi-user`, the system SHALL verify before `listen()` that a bundled/trusted resolver is configured and that exactly one trusted access-policy plugin (`identity.trustedPolicyPlugin`) is registered. Missing resolver configuration, zero policies, or more than one policy SHALL fail startup.

#### Scenario: Missing policy fails startup
- **WHEN** multi-user mode is set but no trusted access policy is registered
- **THEN** startup fails before serving requests

#### Scenario: Duplicate policy fails startup
- **WHEN** two plugins attempt to register the access policy
- **THEN** startup fails rather than choosing one nondeterministically

### Requirement: Single host access policy contract

The system SHALL accept exactly one `authorize({ principal, action, resource }) => Promise<boolean>` from the plugin named by `identity.trustedPolicyPlugin`. The host SHALL call it to decide every protected road it cannot decide by owner-equality alone. `action` values SHALL be stable host constants; `resource` SHALL be bounded plain data identifying the target without secrets.

#### Scenario: Only the named plugin can register the policy
- **WHEN** a plugin not named in `identity.trustedPolicyPlugin` attempts to register a policy
- **THEN** the registration is refused

#### Scenario: Policy decides a protected action
- **WHEN** a protected road is reached with a principal
- **THEN** the host calls `authorize` and proceeds only on `true`

### Requirement: Bounded, fail-closed policy evaluation

The system SHALL bound each policy call by a configured timeout (default 500 ms, range 50–2000 ms). A missing policy, `false`, throw, timeout, or non-boolean result SHALL deny access and emit a structured audit event naming principal, action, resource, and reason.

#### Scenario: Policy timeout denies
- **WHEN** the policy does not resolve within the timeout
- **THEN** access is denied and an audit event is logged

#### Scenario: Non-boolean result denies
- **WHEN** the policy resolves a non-boolean value
- **THEN** access is denied

### Requirement: Exhaustive route and message classification

Every host HTTP route SHALL carry identity metadata: `public`, `device`, or protected `{ action, resource }`. Every browser WS bootstrap frame and inbound message type SHALL map to a classification. In multi-user mode an unclassified protected HTTP route or WS message type SHALL deny rather than inherit authenticated access. Protected plugin HTTP routes SHALL declare equivalent metadata. Coverage SHALL be asserted so an added route/message without classification fails.

#### Scenario: Unclassified protected route denies
- **WHEN** a protected `/api` route has no identity classification in multi-user mode
- **THEN** requests to it are denied rather than allowed

#### Scenario: Unknown WS message type denies
- **WHEN** an inbound WS message type has no classification in multi-user mode
- **THEN** it is refused

#### Scenario: Coverage is enforced by test
- **WHEN** a new protected route or message type is added without classification
- **THEN** the classification-coverage test fails

#### Scenario: Unclassified plugin route is denied at runtime
- **WHEN** a plugin registers an HTTP route that bypasses the guarded host route-registration helper and therefore carries no identity classification
- **THEN** in multi-user mode a catch-all guard denies requests to it rather than letting it inherit authenticated access

### Requirement: Bootstrap and global roads are authorized

In multi-user mode the system SHALL authorize WebSocket bootstrap frames (OpenSpec, branch/HEAD, terminal, session snapshot) and global/workspace/terminal/system commands through owner-equality (for sessions) and the access policy (for non-session resources), so connection bootstrap does not disclose another principal's sessions, paths, branches, or terminals.

#### Scenario: Bootstrap omits unauthorized resources
- **WHEN** a principal connects in multi-user mode
- **THEN** the bootstrap includes only sessions it owns and only workspace/terminal/system state the policy permits

#### Scenario: Global command is policy-gated
- **WHEN** a principal issues a workspace or terminal command in multi-user mode
- **THEN** the host calls the policy and proceeds only on `true`
