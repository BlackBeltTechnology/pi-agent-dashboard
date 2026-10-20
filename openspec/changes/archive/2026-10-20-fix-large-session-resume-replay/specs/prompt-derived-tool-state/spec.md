# Spec Delta

## MODIFIED Requirements

### Requirement: Every replay exit reconciles the registry and recomputes from it

On leaving the replaying state, the system SHALL treat the `prompt_request` messages received during that replay as an authoritative snapshot of the session's pending prompts, SHALL drop tracked entries absent from it, and SHALL then **re-derive** the session's `currentTool`. Pruning alone is insufficient: the derived value written during replay from a stale registry would otherwise survive the prune.

The re-derivation SHALL be: a non-empty reconciled registry yields `"ask_user"`; an empty one leaves the session's event-derived `currentTool` untouched. It SHALL NOT unconditionally write `null` on an empty registry. This is unambiguous precisely because replayed events are not folded, so the stored value at the replay exit is exactly what the events produced.

Every exit from the replaying state SHALL perform this — the `replay_complete` message, the replay idle exit, and the replay cap exit — and all SHALL be guarded so that only the first to fire acts. An unregister during replay is exempt: the session's pending-request registries are cleared on unregister. The operations SHALL occur in the order reconcile → recompute → drain, and the drain SHALL apply to the ephemeral collected promptId set only, never to the live pending-prompt registry that browser-refresh replay depends on.

#### Scenario: Phantom entry dropped on reconnect

- **WHEN** a session has a tracked prompt whose `prompt_dismiss` was lost
- **AND** the bridge reconnects and re-sends no `prompt_request` for it
- **THEN** on the replay exit the entry SHALL be dropped from the registry
- **AND** the session's `currentTool` SHALL be cleared to `null`

#### Scenario: Stale registry does not leave a derived value behind

- **WHEN** a session has a stale tracked prompt and is not mid-turn (no synthetic `agent_start` will follow)
- **AND** replay of stored events includes an `agent_end`, causing the derivation to write `"ask_user"` from the stale registry
- **THEN** the replay exit SHALL re-derive `currentTool` after reconciling
- **AND** the session's `currentTool` SHALL end as `null`, not `"ask_user"`

#### Scenario: Still-pending prompts are retained

- **WHEN** the bridge re-sends a `prompt_request` for a tracked prompt
- **THEN** that entry SHALL be retained
- **AND** the session's `currentTool` SHALL remain `"ask_user"`

#### Scenario: Replay safety timeout also reconciles

- **WHEN** `replay_complete` never arrives and the replay idle exit or cap exit clears the replaying state
- **THEN** the reconcile and re-derivation SHALL run on that path too
- **AND** a stale entry SHALL NOT survive to keep the session unreapable

#### Scenario: A genuinely in-flight tool is not clobbered by the recompute

- **WHEN** a session's last replayed event was a `tool_execution_start` naming a non-`ask_user` tool
- **AND** the reconciled registry is empty
- **THEN** the recomputed `currentTool` SHALL remain that tool's name
- **AND** SHALL NOT be reset to `null`

#### Scenario: The two exits cannot race

- **WHEN** the idle or cap exit fires and a late `replay_complete` arrives afterwards
- **THEN** the first exit SHALL consume and clear the collected promptId set
- **AND** the second SHALL be a no-op, emitting no duplicate replay or broadcast
- **AND** a `prompt_request` that arrived between the two SHALL NOT be dropped

#### Scenario: The live registry survives the drain

- **WHEN** a replay exit drains the collected promptId set
- **THEN** the live pending-prompt registry SHALL retain its still-pending entries
- **AND** a browser refreshing after that exit SHALL still receive the pending prompt

#### Scenario: Mid-turn session keeps the derived state through the trailing agent_start

- **WHEN** a mid-turn session with a genuinely pending prompt completes a replay exit with `currentTool: "ask_user"`
- **AND** the bridge's synthetic `agent_start` arrives afterwards
- **THEN** the session's `currentTool` SHALL remain `"ask_user"`

#### Scenario: Reconcile is scoped to the replaying session

- **WHEN** a session reconciles its registry on a replay exit
- **THEN** pending prompts tracked for other sessions SHALL be unaffected
