# goal-plugin-status-relay Specification

## Purpose

Relay per-session goal lifecycle status from an in-session pi extension through the dashboard bridge and server to subscribed browsers. The bridge normalizes the extension's raw goal events into a clean snapshot, the server caches the latest snapshot per session and rebroadcasts it, and the client derives the current goal status by folding the received event stream.

## Requirements

### Requirement: Bridge snapshot normalization

The bridge SHALL observe the goal extension's `pi-goal-hermes:event` custom messages, normalize their `details` into a `GoalStatusSnapshot`, and forward it to the server as a `goal_status` plugin message over the `dashboard:plugin-message` channel.

#### Scenario: Extension emits a goal event

- **WHEN** a `message_end` occurs whose message `customType` is `pi-goal-hermes:event` and whose `details` includes a string `eventType`
- **THEN** the bridge emits a `dashboard:plugin-message` with `pluginId` `goal`, `messageType` `goal_status`, and a normalized `GoalStatusSnapshot` payload

#### Scenario: Event type maps to snapshot status

- **WHEN** the extension `eventType` is `goal-achieved`
- **THEN** the snapshot `status` is `done`
- **AND** `goal-paused` maps to `paused`, `goal-cleared` maps to `cleared`, and `goal-set` / `goal-continuing` / `goal-resumed` map to `active`

#### Scenario: Non-goal messages ignored

- **WHEN** a `message_end` occurs whose message `customType` is not `pi-goal-hermes:event`, or whose `details` lacks a string `eventType`
- **THEN** the bridge forwards nothing

### Requirement: Server per-session snapshot cache and broadcast

The server SHALL maintain the latest goal snapshot per session, deleting it when the snapshot status is `cleared` and otherwise storing it, and SHALL rebroadcast every received snapshot to subscribed browsers as a `plugin_event`.

#### Scenario: Active snapshot received

- **WHEN** the server receives a `goal_status` plugin message with a `sessionId` and a payload whose `status` is not `cleared`
- **THEN** the server stores the snapshot as the latest for that session
- **AND** broadcasts a `plugin_event` with `pluginId` `goal`, the `sessionId`, and event `eventType` `goal_status` carrying the snapshot

#### Scenario: Cleared snapshot received

- **WHEN** the server receives a `goal_status` plugin message whose payload `status` is `cleared`
- **THEN** the server deletes the cached snapshot for that session
- **AND** still broadcasts the `cleared` snapshot as a `plugin_event`

#### Scenario: Malformed or session-less message

- **WHEN** a received `goal_status` message has no `sessionId`, no payload, or a payload whose `status` is not a string
- **THEN** the server caches nothing and broadcasts nothing

#### Scenario: Per-session isolation

- **WHEN** snapshots arrive for different `sessionId` values
- **THEN** each session's latest snapshot is cached and broadcast independently, keyed by its own `sessionId`

### Requirement: Client snapshot derivation

The client SHALL derive the current goal snapshot for a session by folding its `goal_status` dashboard events to the last valid snapshot, yielding no snapshot when the latest status is `cleared` or none exists.

#### Scenario: Latest snapshot wins

- **WHEN** the client folds a session's event stream containing one or more `goal_status` events with a string `status`
- **THEN** the derived snapshot is the last such event's snapshot (last write wins)

#### Scenario: Cleared or empty yields nothing

- **WHEN** the latest `goal_status` event has status `cleared`, or the stream contains no valid `goal_status` event
- **THEN** the derived snapshot is `null`
