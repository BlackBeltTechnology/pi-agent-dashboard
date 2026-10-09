# plugin-event-forwarding Specification

## Purpose
TBD - created by archiving change add-plugin-bridge-contributions. Update Purpose after archive.

## Requirements

### Requirement: Plugin bridges SHALL declare forwarded bus channels at runtime

A plugin bridge entry SHALL be able to declare EventBus channels for the main bridge to forward by emitting `dashboard:register-event-forward` with `{ pluginId, channels }`, where `channels` maps a channel name to `{ as?, delivery, key? }`. `as` is the forwarded `eventType` (default: the channel name), `delivery` is one of `live`, `latest`, `stream`, and `key` names the top-level payload field used to group retained messages (required for `latest` and `stream`). The main bridge SHALL subscribe each newly declared channel exactly once and forward it through the same gate as core-declared channels. Core code SHALL NOT need to name a plugin's channels.

#### Scenario: A declared channel is forwarded with its mapped type
- **GIVEN** a plugin declared `"subagents:entry": { as: "subagent_entry", delivery: "stream", key: "agentId" }`
- **WHEN** any extension emits `subagents:entry` while the session is ready and connected
- **THEN** the bridge SHALL send an `event_forward` with `eventType: "subagent_entry"` and the emitted payload

#### Scenario: Repeated identical declaration is idempotent
- **WHEN** the same plugin emits the same declaration twice
- **THEN** the channel SHALL have exactly one subscription and a single emission SHALL produce exactly one `event_forward`

#### Scenario: Conflicting declaration keeps the first owner
- **GIVEN** a channel already declared by core or by another plugin
- **WHEN** a second plugin declares the same channel with a different spec
- **THEN** the first declaration SHALL remain in effect, the conflict SHALL be counted, and no error SHALL be thrown

### Requirement: Declarations SHALL survive any load order via a ready handshake

The main bridge SHALL attach its declaration listener at extension initialization and then emit `dashboard:bridge-ready`. A plugin bridge SHALL declare on activation and again on every `dashboard:bridge-ready`. A reloaded main bridge SHALL emit `dashboard:bridge-ready` again.

#### Scenario: Plugin activates before the main bridge
- **GIVEN** a plugin bridge that emitted its declaration before the main bridge attached its listener
- **WHEN** the main bridge initializes and emits `dashboard:bridge-ready`
- **THEN** the plugin SHALL re-declare and its channels SHALL be forwarded

#### Scenario: Declarations survive a main bridge reload
- **WHEN** the main bridge is reloaded
- **THEN** after the new instance emits `dashboard:bridge-ready`, previously declared plugin channels SHALL be forwarded again without duplicate `event_forward` messages

### Requirement: Declarations SHALL be validated as untrusted input

The main bridge SHALL reject a whole declaration whose `pluginId` does not match `^[a-z0-9][a-z0-9-]{0,63}$`, and SHALL reject a declaration entry whose `key` does not match `^[A-Za-z][A-Za-z0-9_]{0,31}$`, or whose channel name does not match `^[a-z0-9][a-z0-9:_-]{0,63}$` or lacks a `:`, whose `as` does not match `^[a-z0-9_]{1,64}$`, whose `as` names a pi core event type or a bridge control message type, whose `delivery` is unknown, or whose `latest`/`stream` spec lacks `key`. It SHALL accept at most 32 channels per plugin and 256 plugin channels in total. Rejected entries SHALL be ignored and counted; the rest of the declaration SHALL still apply.

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

### Requirement: Delivery modes SHALL govern retention while not forwardable

A declared channel SHALL forward live whenever the session is ready, the bridge active, and the connection up. When not forwardable: `live` SHALL drop the message; `latest` SHALL retain only the newest message per key and flush it when forwardable; `stream` SHALL retain every message per key in emission order and flush all of them in order when forwardable. `stream` retention SHALL be bounded per key (2000 messages or 2 MiB). `latest` and `stream` retention together SHALL hold at most 64 keys across all plugins, evicting the oldest key; drops SHALL be counted. `stream` and `latest` messages SHALL NOT be coalesced or throttled on the live path.

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

### Requirement: Forwarding registry SHALL be observable

`/api/health` SHALL report, per bridge-reported session aggregate, the number of plugin-declared channels, rejected declaration entries, conflicts, stream messages retained, and stream messages dropped.

#### Scenario: Health reports declared channels
- **GIVEN** a connected session whose plugins declared two channels
- **WHEN** `/api/health` is read
- **THEN** it SHALL report two declared plugin channels and zero rejections

#### Scenario: Distinct-key flood stays bounded
- **GIVEN** a `latest` channel while disconnected
- **WHEN** 10,000 messages with distinct key values are emitted
- **THEN** at most 64 keys SHALL be retained and the evictions SHALL be counted
