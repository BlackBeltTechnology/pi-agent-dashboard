# Spec Delta

## Purpose

Lets a plugin decide, for the event types it owns, how the server store reduces an over-size event, which identity fields its truncation placeholder keeps, and which stored events a new event supersedes, so the store holds no plugin-specific rule.

## ADDED Requirements

### Requirement: The store SHALL consult the owning plugin's policy for owned event types

The server SHALL let a plugin server register a store policy. The store SHALL call it for events of types the plugin owns and for `tool_execution_update` / `tool_execution_end` events of a tool the plugin claims, and for no other event. With no registered policy, the store SHALL apply only its generic rules.

#### Scenario: Policy consulted for an owned type only
- **GIVEN** the subagents plugin registered a store policy
- **WHEN** a `subagent_entry`, an `Agent` `tool_execution_end` and a `bash` `tool_execution_end` are stored
- **THEN** the policy SHALL be consulted for the `subagent_entry` and the `Agent` event only

### Requirement: An owner elision SHALL run before generic truncation

For an over-ceiling owned event, the store SHALL first apply the policy's elision. It SHALL use the reduced copy when the policy returns one, then apply the generic caps. The policy SHALL receive read access to resident events of its owned types and SHALL NOT mutate the incoming event.

#### Scenario: Elision with all steps resident
- **GIVEN** an over-ceiling `subagent_completed` with `entryCount` 300 whose 300 `subagent_entry` rows are resident
- **WHEN** it is stored
- **THEN** its `details.entries` SHALL be elided and `entryCount` kept

#### Scenario: A missing resident step blocks elision
- **GIVEN** the same event while the store holds entries 0..298 only
- **WHEN** it is stored
- **THEN** the policy SHALL return no reduced copy and the event SHALL be bounded via the generic path

### Requirement: The placeholder SHALL keep owner-declared identity fields

When an owned event is replaced by the over-size placeholder, the placeholder SHALL keep `eventType` plus the scalar fields the policy names as identity, each cut to 256 bytes. The placeholder SHALL stay within the per-event ceiling.

#### Scenario: Over-size terminal subagent frame keeps its id
- **WHEN** an irreducible over-size `subagent_completed { id: "a1", details: { status: "completed", ... } }` is stored
- **THEN** the stored data SHALL be the placeholder plus `id: "a1"` and `details.status: "completed"`

### Requirement: A stored owned event MAY supersede earlier owned events

After storing an owned event, the store SHALL drop the earlier owned events whose seqs the policy returns, and SHALL drop no other event.

#### Scenario: Finished block drops its deltas
- **GIVEN** stored `subagent_delta` events with `blockId` 2 for agent a1
- **WHEN** a `subagent_entry` with `blockId` 2 for a1 is stored
- **THEN** those `subagent_delta` events SHALL be dropped from the store

### Requirement: The owner MAY pin events against store trimming

When the store trims a session's events to its retention bound, it SHALL keep the owned events the policy marks as retained, up to 500 per session, and trim others first. Pins beyond that cap SHALL be ignored oldest-first and counted.

#### Scenario: Identity of an open subagent survives a middle trim
- **GIVEN** open subagent a1 whose `subagent_created` lies in the part of the stream the store trims
- **WHEN** the store trims the session
- **THEN** a1's `subagent_created` and latest `subagent_started` SHALL still be stored

### Requirement: The owner MAY keep a retained tail update a tool end would subsume

When a tool end would drop a retained tail update of a claimed tool, the store SHALL first ask the owner's policy, and SHALL keep the update when the policy vetoes the drop.

#### Scenario: Agent tail kept until its subagent ends
- **GIVEN** a retained `Agent` tail update whose subagent identity the policy still needs
- **WHEN** the `Agent` `tool_execution_end` is stored
- **THEN** the tail update SHALL stay stored

### Requirement: The owner MAY bound its streamed events

For an owned streamed event, the store SHALL apply the owner's bound before the generic ceiling.

#### Scenario: Oversized delta piece bounded by its owner
- **WHEN** a `subagent_delta` whose text exceeds the owner's bound is stored
- **THEN** it SHALL be stored cut to the owner's bound
