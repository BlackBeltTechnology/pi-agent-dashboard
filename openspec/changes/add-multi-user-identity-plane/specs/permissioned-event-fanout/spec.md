## Purpose

Replaces the unconditional global broadcast of plugin domain events with a host-owned, policy-driven targeted send **when a host access policy is registered**, so each domain event reaches only sockets whose principal the policy permits for that resource. When no policy is registered, domain-event fan-out is unchanged from before this change.

## ADDED Requirements

### Requirement: Domain events use policy-driven targeted send when a policy is registered

When a host access policy is registered, the system SHALL deliver a plugin domain event only to sockets whose principal the policy authorizes for the event's action and resource, evaluated per candidate socket, and SHALL NOT fan a domain event out to every socket unconditionally. When no policy is registered, the system SHALL preserve the existing global broadcast.

#### Scenario: Event reaches only permitted sockets
- **WHEN** a domain event tagged with a resource is emitted and a policy is registered
- **THEN** it is delivered only to sockets whose principal the policy authorizes for that resource
- **AND** it is delivered to no other socket

#### Scenario: Principal-less socket receives no domain event under a policy
- **WHEN** a domain event is fanned out under a registered policy and a candidate socket has `ws.principal === null`
- **THEN** that socket does not receive the event

#### Scenario: No policy preserves existing broadcast
- **WHEN** a domain event is emitted and no host access policy is registered
- **THEN** it is delivered exactly as before this change

### Requirement: Host owns the send, policy owns the decision

The host SHALL perform the targeted send; the trusted policy plugin SHALL supply only the boolean decision via the host access policy. When a policy is registered, absent an authorized decision — a false result, a throw, a timeout, or a non-boolean — the event SHALL NOT be delivered to that socket (fail-closed).

#### Scenario: Policy governs delivery
- **WHEN** a domain event is emitted and the policy is registered
- **THEN** the host calls the policy per candidate socket and delivers only on a `true` result

#### Scenario: Policy failure denies delivery
- **WHEN** the policy throws or times out for a candidate socket
- **THEN** the event is not delivered to that socket and the denial is logged

### Requirement: Session-scoped flow frames keep their subscription road

The system SHALL continue to deliver session-scoped flow frames via existing session subscription (now owner-gated per `session-ownership-scoping`), unchanged in shape. This capability governs only the previously-global domain-event road, not the per-session flow road.

#### Scenario: Flow frames still delivered by owner-gated subscription
- **WHEN** a session-scoped flow frame is delivered to a subscriber that owns the session
- **THEN** delivery follows the existing subscription path, not the domain-event policy road
