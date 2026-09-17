## Purpose

Replaces the global broadcast of domain events with a host-owned fan-out that delivers each event only to sockets whose principal is permitted to see it, using a plugin-supplied permission predicate.

## ADDED Requirements

### Requirement: Host-owned permissioned fan-out

The system SHALL provide a host-owned `broadcastToPermitted` operation for domain events that, for each connected socket, delivers the event only when the socket's principal is permitted to see it. The system SHALL NOT fan domain events out to every socket unconditionally.

#### Scenario: Event reaches only permitted sockets
- **WHEN** a domain event tagged with a resource id is emitted
- **THEN** it is delivered to sockets whose principal is permitted for that resource
- **AND** it is not delivered to any other socket

#### Scenario: Principal-less socket receives no permissioned event
- **WHEN** a domain event is fanned out and a connected socket has `ws.principal === null`
- **THEN** that socket does not receive the event

### Requirement: Permission predicate is plugin-supplied

The system SHALL let a plugin register a `canSee(principal, resourceId) => boolean` predicate that the host calls to decide delivery. The host SHALL own the targeted send; the plugin SHALL own only the decision. Absent a registered predicate, a permissioned event SHALL default to no delivery (fail-closed).

#### Scenario: Plugin predicate governs delivery
- **WHEN** a plugin has registered a `canSee` predicate and a domain event is emitted
- **THEN** the host calls `canSee(principal, resourceId)` per candidate socket and delivers only on `true`

#### Scenario: No predicate registered
- **WHEN** a permissioned domain event is emitted and no `canSee` predicate is registered
- **THEN** the event is delivered to no socket

### Requirement: Session-scoped flow frames are unaffected

The system SHALL continue to deliver session-scoped flow frames via existing session subscription, unchanged. This capability governs only the previously-global domain-event road, not the per-session flow road.

#### Scenario: Flow frames still delivered by subscription
- **WHEN** a session-scoped flow frame is delivered to its subscribers
- **THEN** delivery follows the existing session subscription path and is not gated by `canSee`
