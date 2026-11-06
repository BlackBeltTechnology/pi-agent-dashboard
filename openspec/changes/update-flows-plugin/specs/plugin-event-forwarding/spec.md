# Spec Delta

## ADDED Requirements

### Requirement: Plugins SHALL request a commands resend via dashboard:commands-changed
The main bridge SHALL listen on the bus channel `dashboard:commands-changed` and, on each emission from any extension, resend `commands_list` to the dashboard server. The payload SHALL be ignored. Core SHALL NOT name a plugin channel to trigger this resend.

#### Scenario: Plugin emission triggers a resend
- **WHEN** a plugin bridge emits `dashboard:commands-changed`
- **THEN** the main bridge SHALL send a fresh `commands_list` for the session

#### Scenario: Payload is ignored
- **WHEN** `dashboard:commands-changed` is emitted with an arbitrary payload
- **THEN** the main bridge SHALL resend `commands_list` and SHALL NOT forward the payload

### Requirement: A forwarded event type SHALL have a single owning plugin
The main bridge SHALL reject a declaration entry whose `as` type is already owned by an entry from a different `pluginId`; the first owner wins. Each such rejection SHALL be counted in the plugin-forward counters reported by `/api/health`, and the rest of the declaration SHALL still apply. A plugin re-declaring an `as` type it already owns SHALL be idempotent: it SHALL be accepted, SHALL NOT be counted as a rejection, and SHALL NOT duplicate forwarding.

#### Scenario: Another plugin cannot take an owned event type
- **GIVEN** plugin `flows` declared `"flow:decision": { as: "flow_decision", delivery: "stream", key: "stepId" }`
- **WHEN** plugin `other` declares a channel with `as: "flow_decision"`
- **THEN** the `other` entry SHALL be rejected and `flows` SHALL keep forwarding `flow_decision`
- **AND** the rejection SHALL be counted in `/api/health`

#### Scenario: Same plugin re-declaring is idempotent
- **GIVEN** plugin `flows` declared `"flow:decision": { as: "flow_decision", delivery: "stream", key: "stepId" }`
- **WHEN** plugin `flows` emits the same declaration again on `dashboard:bridge-ready`
- **THEN** the entry SHALL be accepted and no rejection SHALL be counted
- **AND** each `flow:decision` emission SHALL produce exactly one `event_forward`

## MODIFIED Requirements

### Requirement: Declarations SHALL be validated as untrusted input

The main bridge SHALL reject a whole declaration whose `pluginId` does not match `^[a-z0-9][a-z0-9-]{0,63}$`, and SHALL reject a declaration entry whose `key` does not match `^[A-Za-z][A-Za-z0-9_]{0,31}$`, or whose channel name does not match `^[a-z0-9][a-z0-9:_-]{0,63}$` or lacks a `:`, whose `as` does not match `^[a-z0-9_]{1,64}$`, whose `as` names a pi core event type or a bridge control message type, whose `delivery` is unknown, or whose `latest`/`stream` spec lacks `key`. Plugin-owned event types such as `flow_*` SHALL NOT be reserved. It SHALL accept at most 32 channels per plugin and 256 plugin channels in total. Rejected entries SHALL be ignored and counted; the rest of the declaration SHALL still apply.

#### Scenario: Malformed entry is ignored, valid entries apply
- **WHEN** a declaration contains one valid channel and one channel named `Bad Name`
- **THEN** the valid channel SHALL be forwarded, `Bad Name` SHALL NOT be subscribed, and a rejection SHALL be counted

#### Scenario: Non-primitive key value is not retained
- **GIVEN** a `stream` channel with key `agentId`, while not forwardable
- **WHEN** a message whose `agentId` is an object or a string longer than 128 characters is emitted
- **THEN** it SHALL NOT be retained, and the rejection SHALL be counted

#### Scenario: Prototype-named keys are inert
- **WHEN** a message with `agentId: "__proto__"` is retained and flushed
- **THEN** it SHALL be forwarded like any other key value and no shared prototype SHALL be modified

#### Scenario: Core event type cannot be hijacked
- **WHEN** a plugin declares a channel with `as: "message_update"`
- **THEN** the entry SHALL be rejected and no `event_forward` with that type SHALL originate from the plugin channel

#### Scenario: flow_* types are not reserved
- **WHEN** the flows plugin declares `"flow:flow-started": { as: "flow_started", delivery: "stream", key: "flowName" }`
- **THEN** the entry SHALL be accepted and no rejection SHALL be counted
