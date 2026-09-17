## Purpose

Replaces the unconditional global broadcast of plugin domain events with a host-owned, policy-driven targeted send, so in multi-user mode each domain event reaches only sockets whose principal the host access policy permits for that resource.

## ADDED Requirements

### Requirement: Domain events use policy-driven targeted send in multi-user mode

When `identity.mode = multi-user`, the system SHALL deliver a plugin domain event only to sockets whose principal the host access policy authorizes for the event's action and resource, evaluated per candidate socket. The system SHALL NOT fan a domain event out to every socket unconditionally in multi-user mode.

#### Scenario: Event reaches only permitted sockets
- **WHEN** a domain event tagged with a resource is emitted in multi-user mode
- **THEN** it is delivered only to sockets whose principal the policy authorizes for that resource
- **AND** it is delivered to no other socket

#### Scenario: Principal-less socket receives no domain event
- **WHEN** a domain event is fanned out and a candidate socket has `ws.principal === null`
- **THEN** that socket does not receive the event

### Requirement: Host owns the send, policy owns the decision

The host SHALL perform the targeted send; the trusted policy plugin SHALL supply only the boolean decision via the host access policy. Absent an authorized decision — no policy, a false result, a throw, a timeout, or a non-boolean — the event SHALL NOT be delivered to that socket (fail-closed).

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

### Requirement: Legacy mode preserves existing broadcast

When `identity.mode = legacy`, the system SHALL preserve the existing global domain-event broadcast behavior unchanged.

#### Scenario: Legacy broadcast unchanged
- **WHEN** a domain event is emitted in legacy mode
- **THEN** it is delivered exactly as before this change
