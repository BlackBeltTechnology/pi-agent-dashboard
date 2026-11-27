# plugin-synthetic-events Specification

## Purpose
Lets a plugin server learn of every real session end and append and broadcast events of the event types it owns, so heals for work a session left open live in the owning plugin instead of core.

## Requirements

### Requirement: A plugin server SHALL append events of event types it owns

The plugin server context SHALL offer an append operation taking a session id and an event. When the plugin owns the event's type, the server SHALL store it with the next seq of that session and broadcast it to that session's subscribers exactly like a bridge-forwarded event.

#### Scenario: Appended event reaches subscribers
- **GIVEN** plugin `subagents` owns `subagent_failed`
- **WHEN** it appends `subagent_failed { id: "a1", healedBy: "session_ended" }` to session S
- **THEN** S's subscribers SHALL receive it as an `event` with the next seq, and a later replay of S SHALL include it

### Requirement: Appending an event type the plugin does not own SHALL be refused

The server SHALL refuse an append whose event type is a pi core type, a protocol type, or a type owned by another plugin or by no plugin. The refusal SHALL be returned to the caller and counted, and SHALL NOT throw.

#### Scenario: Core type refused
- **WHEN** a plugin appends an event of type `tool_execution_end`
- **THEN** the append SHALL be refused and nothing SHALL be stored or broadcast

### Requirement: A status-ended notification SHALL fire on every real session end

The plugin server context SHALL offer a status-ended notification, separate from the existing session-ended (unregister) notification, which stays unchanged. It SHALL fire on every end transition of that seam (unregister, status set to ended, a later end-reason change), on the same seam as core's tool-call heal, so handlers SHALL be idempotent. It SHALL NOT fire for a session that relocated to another id. An event appended while the session is replaying SHALL be stored but not broadcast.

#### Scenario: Status set to ended
- **WHEN** a session's status is updated to `ended` without unregistering
- **THEN** each plugin's status-ended handler SHALL be called for that session
- **AND** the existing session-ended (unregister) handlers SHALL NOT be called

#### Scenario: Relocation is not an end
- **WHEN** a session is moved to a new id
- **THEN** no status-ended handler SHALL be called for the old id

#### Scenario: Re-fire on reason change heals nothing twice
- **GIVEN** the subagents plugin healed open subagent a1 on the first end transition
- **WHEN** the session's end reason changes and the notification fires again
- **THEN** no second `subagent_failed` for a1 SHALL be appended
