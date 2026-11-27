# Spec Delta

## ADDED Requirements

### Requirement: The owning plugin SHALL supply the defer key and deferred copy of its event types

A plugin server SHALL be able to register a delivery policy for event types it owns, returning a defer key for an event (or none) and the bounded copy to defer. The gateway SHALL use the policy result for those types, SHALL treat a policy that throws as returning no key, and SHALL hold no plugin-specific case.

#### Scenario: Subagent end deferred through the plugin policy
- **GIVEN** the subagents plugin registered its delivery policy
- **WHEN** A's `subagent_completed` is sent to a saturated socket
- **THEN** it SHALL be deferred under the key and as the bounded copy the policy returned

#### Scenario: Plugin absent
- **WHEN** the subagents plugin is not loaded and a `subagent_completed` is sent to a saturated socket
- **THEN** it SHALL be shed like any transcript frame

## MODIFIED Requirements

### Requirement: Every server-to-browser frame has a delivery class

Every frame the server sends to a browser SHALL belong to exactly one delivery class: `transcript` (per-session event stream, recoverable via history backfill or replay), `blocking` (a pending-prompt frame governed by the pending-prompt-recovery exemption), or `state` (a frame that must not be lost, identified by a `(type, entityKey)` key, where a newer frame for the same key supersedes an older one). `sessions_reordered` is `state`-class: it is a window-projected FULL per-cwd ordering snapshot, so the latest frame per cwd is the whole truth. A per-session event frame whose event type is owned by a plugin whose server registered a delivery policy giving it a defer key (the subagents plugin gives one for `subagent_completed`, `subagent_failed`, `subagent_stop_result` and `subagent_registry_snapshot`) is `transcript`-class with a defer key: it is sent like any transcript frame, but where a transcript frame would be shed it SHALL be deferred as a `state` frame under that key instead. Core SHALL take the key from that policy and SHALL NOT name any plugin event type. A frame's class and defer key SHALL be fixed by its message type and, for a per-session event frame, its event type and the owner's policy; they SHALL NOT depend on socket condition.

#### Scenario: Connect-bootstrap frames are state-class
- **WHEN** the server emits any of `pinned_dirs_updated`, `workspaces_updated`, `favorite_models_updated`, `display_prefs_updated`, `reachability_updated`, `openspec_update`, `openspec_get_result`, `git_head_update`, `terminal_added`, `terminal_updated`, `terminal_removed`, `sessions_page_result`, `sessions_reordered`, or `sessions_snapshot`
- **THEN** the frame SHALL be delivered under the `state` class

#### Scenario: Entity-keyed state frames share a key per entity
- **WHEN** two `state` frames of the same type refer to the same entity (the same `cwd` for `openspec_update` / `git_head_update` / `sessions_page_result` / `sessions_reordered`, the same terminal id for `terminal_added` / `terminal_updated` / `terminal_removed`)
- **THEN** they SHALL resolve to the same delivery key
- **AND** `terminal_added`, `terminal_updated`, and `terminal_removed` for one terminal id SHALL resolve to one shared key so that a later lifecycle frame supersedes an earlier one

#### Scenario: Session event frames are transcript-class
- **WHEN** the server sends a per-session event frame whose event type has no owner-declared defer key, or a session-registry broadcast (`session_updated`, `session_added`, `session_removed`)
- **THEN** the frame SHALL be delivered under the `transcript` class, subject to the back-pressure shed; a shed registry broadcast is recovered by the reconcile debt (see "A shed session-registry frame SHALL be reconciled from current state")

#### Scenario: Subagent end frame has a per-subagent defer key
- **WHEN** the server sends a per-session event frame for session S whose event is `subagent_completed` or `subagent_failed` for agent A
- **THEN** the frame SHALL carry the defer key the subagents plugin's policy returns, unique to S and A, different for a synthesized heal than for a real end

#### Scenario: Subagent end without an id has no defer key
- **WHEN** a `subagent_completed` event frame carries no string `id`, so the subagents policy returns no key
- **THEN** the frame SHALL have no defer key and SHALL be shed like any transcript frame

#### Scenario: Subagent liveness frames have defer keys
- **WHEN** the server sends a per-session event frame for session S whose event is `subagent_stop_result` for agent A, or `subagent_registry_snapshot`
- **THEN** per the subagents plugin's policy, the stop answer SHALL carry a defer key unique to S and A and different from A's end key, and the snapshot a defer key unique to S

#### Scenario: A stop answer never replaces an end
- **GIVEN** a saturated socket with A's `subagent_completed` pending
- **WHEN** A's `subagent_stop_result` is sent to it
- **THEN** on drain the browser SHALL receive both frames

#### Scenario: A reorder deferred under back-pressure is delivered latest-wins
- **GIVEN** a socket above the threshold
- **WHEN** three `sessions_reordered` frames for `/repoA` and one for `/repoB` are broadcast
- **THEN** none SHALL be shed
- **AND** on drain the socket SHALL receive exactly one `sessions_reordered` for `/repoA` carrying the last ordering and one for `/repoB`
