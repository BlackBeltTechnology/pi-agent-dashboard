# Spec Delta

## ADDED Requirements

### Requirement: A plugin SHALL own the event types its manifest lists

The event types matched by a plugin manifest's `eventTypes` SHALL be owned by that plugin. Its bridge MAY declare channels forwarded as an owned type, even one core reserved before. A declaration forwarding as a type owned by another plugin SHALL be refused and counted. pi core and protocol message types SHALL stay reserved for every plugin.

#### Scenario: Owner declares a lifecycle type
- **GIVEN** the subagents plugin manifest lists `subagent_*` in `eventTypes`
- **WHEN** its bridge declares `"subagents:created": { as: "subagent_created", delivery: "latest", key: "id", group: "lifecycle" }`
- **THEN** the declaration SHALL be accepted and `subagents:created` SHALL be forwarded as `subagent_created`

#### Scenario: Non-owner is refused
- **WHEN** plugin `other` declares a channel with `as: "subagent_created"`
- **THEN** the entry SHALL be refused and counted, and no error SHALL be thrown

#### Scenario: Core no longer maps the channel
- **WHEN** the subagents plugin is absent and an extension emits `subagents:created`
- **THEN** the bridge SHALL NOT forward it

#### Scenario: Core types stay reserved
- **WHEN** a plugin whose manifest lists `tool_execution_end` declares a channel with that `as`
- **THEN** the entry SHALL be refused and counted

### Requirement: Latest channels of one group SHALL share one slot per key

A `latest` declaration MAY name a `group`. Channels of one plugin in the same group SHALL share a single retained message per key while not forwardable: the newest message across those channels.

#### Scenario: Terminal frame supersedes created and started
- **GIVEN** created, started and completed declared `latest`, key `id`, group `lifecycle`, while disconnected
- **WHEN** created, started and completed are emitted for agent `a1` and the connection returns
- **THEN** the bridge SHALL forward exactly the completed frame for `a1`

## MODIFIED Requirements

### Requirement: Delivery modes SHALL govern retention while not forwardable

A declared channel SHALL forward live whenever the session is ready, the bridge active, and the connection up. When not forwardable: `live` SHALL drop the message; `latest` SHALL retain only the newest message per key (per group when the declaration names one) and flush it when forwardable; `stream` SHALL retain every message per key in emission order and flush all of them in order when forwardable. `stream` retention SHALL be bounded per key (2000 messages or 2 MiB). `latest` and `stream` retention together SHALL hold at most 64 keys per plugin, or the plugin's declared `maxKeys` up to 256, evicting that plugin's oldest key; drops SHALL be counted per plugin. `stream` and `latest` messages SHALL NOT be coalesced or throttled on the live path.

#### Scenario: Stream messages emitted before ready are flushed in order
- **GIVEN** a `stream` channel and a session that is not yet ready
- **WHEN** three messages for the same key are emitted and the session then becomes ready
- **THEN** the bridge SHALL forward all three in emission order

#### Scenario: Interleaving across stream channels is preserved
- **GIVEN** two `stream` channels of the same plugin keyed by `agentId`, while not forwardable
- **WHEN** messages are emitted as delta, delta, entry, delta for agent `a`
- **THEN** on flush they SHALL be forwarded in exactly that order

#### Scenario: Latest keeps only the newest per key
- **GIVEN** a `latest` channel while disconnected
- **WHEN** three messages for key `a` and one for key `b` are emitted and the connection returns
- **THEN** the bridge SHALL forward exactly the newest `a` message and the `b` message

#### Scenario: Stream bound drops oldest and counts
- **WHEN** more than 2000 messages for one key accumulate while not forwardable
- **THEN** the oldest messages beyond the bound SHALL be dropped and the drop counter SHALL increase by the number dropped

#### Scenario: One plugin cannot evict another
- **GIVEN** plugin `flows` retains 10 keys while not forwardable
- **WHEN** plugin `subagents` retains 64 keys
- **THEN** all 10 `flows` keys SHALL still be flushed when forwardable
