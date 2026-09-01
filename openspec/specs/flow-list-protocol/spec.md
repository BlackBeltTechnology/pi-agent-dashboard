# flow-list-protocol Specification

## Purpose

Defines how the set of available flows travels from a pi session to the browser: the `FlowInfo` shape, the extension-to-server and server-to-browser `flows_list` messages, and the bridge-side query that produces the list.

## Requirements

### Requirement: FlowInfo type definition
A shared `FlowInfo` type SHALL be defined in `src/shared/types.ts` with properties: `name: string`, `description: string`, `taskRequired: boolean`.

#### Scenario: FlowInfo shape
- **WHEN** a flow is discovered by pi-flows
- **THEN** its metadata SHALL be representable as a `FlowInfo` with name, description, and taskRequired fields

### Requirement: Extension-to-server flows_list message
The extension→server protocol SHALL include a `flows_list` message type with `sessionId: string` and `flows: FlowInfo[]`.

#### Scenario: Bridge sends flows_list on connect
- **WHEN** the bridge registers a session with the server
- **THEN** it SHALL send a `flows_list` message containing the flows discovered via `flow:list-flows` event

#### Scenario: Bridge sends flows_list on rediscover
- **WHEN** pi-flows emits `flow:rediscover` or `flow:complete`
- **THEN** the bridge SHALL send an updated `flows_list` message

#### Scenario: pi-flows not installed
- **WHEN** the `flow:list-flows` event has no listener (pi-flows not installed)
- **THEN** the bridge SHALL send a `flows_list` message with an empty array

### Requirement: Server-to-browser flows_list message
The server→browser protocol SHALL include a `flows_list` message type with `sessionId: string` and `flows: FlowInfo[]`.

#### Scenario: Server forwards flows_list to browsers
- **WHEN** the server receives a `flows_list` message from the bridge
- **THEN** it SHALL forward the message to all connected browser clients

### Requirement: Bridge queries flows via flow:list-flows event
The bridge SHALL query available flows by emitting `flow:list-flows` with a probe object and reading `probe.flows`. This replaces filtering `pi.getCommands()` by source.

#### Scenario: Successful flow query
- **WHEN** the bridge emits `flow:list-flows` with a probe object
- **AND** pi-flows populates `probe.flows` with flow metadata
- **THEN** the bridge SHALL use that array for the `flows_list` message

#### Scenario: No pi-flows listener
- **WHEN** the bridge emits `flow:list-flows` and no listener populates the probe
- **THEN** `probe.flows` SHALL be undefined and the bridge SHALL default to an empty array
