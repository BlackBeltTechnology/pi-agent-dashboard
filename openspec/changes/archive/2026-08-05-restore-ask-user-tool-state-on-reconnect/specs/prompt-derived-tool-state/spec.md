# prompt-derived-tool-state Specification

## Purpose

Keeps a session's `currentTool` truthful about being blocked on the user, using the server's pending-prompt registry rather than only the live `tool_execution_start` event. Without it, a bridge reconnect or a server restart erases the `ask_user` state while the prompt is still pending, and the session card, the unread stamp, the `questionFirst` ordering, and the embed-lifecycle reaper all silently disagree with the dialog the user is looking at.

## ADDED Requirements

### Requirement: Pending prompts are readable from the browser gateway

The browser gateway SHALL expose a read predicate over its PromptBus pending-prompt registry, reporting whether a given session has at least one tracked pending prompt. The registry itself SHALL NOT be exposed to session-state or lifecycle code.

#### Scenario: Session with a tracked prompt

- **WHEN** `trackPromptRequest(sessionId, msg)` has been called for a prompt that has not been cleared
- **THEN** `hasPendingPromptRequests(sessionId)` SHALL return `true`

#### Scenario: Session whose last prompt cleared

- **WHEN** every tracked prompt for a session has been cleared via `clearPromptRequest`
- **THEN** `hasPendingPromptRequests(sessionId)` SHALL return `false`

#### Scenario: Session that never had a prompt

- **WHEN** no prompt was ever tracked for a session
- **THEN** `hasPendingPromptRequests(sessionId)` SHALL return `false`

### Requirement: A pending prompt sets the session's ask_user tool state

When a `prompt_request` is received for a session, the system SHALL set that session's `currentTool` to `"ask_user"` unless a non-`ask_user` tool is currently in flight for that session. Because the `prompt_request` handler does not run inside the forwarded-event path, this SHALL be an explicit session-state write in that handler, not a consequence of event extraction.

#### Scenario: Prompt raised while no tool is in flight

- **WHEN** a `prompt_request` arrives for a session whose `currentTool` is `null`
- **THEN** the session's `currentTool` SHALL become `"ask_user"`

#### Scenario: Prompt raised while a real tool is in flight

- **WHEN** a `prompt_request` arrives for a session whose `currentTool` is `"bash"`
- **THEN** the session's `currentTool` SHALL remain `"bash"`

#### Scenario: Prompt raised without an ask_user tool call

- **WHEN** a `prompt_request` arrives for a session that has issued no `ask_user` tool call (a flow- or plugin-raised prompt)
- **THEN** the session's `currentTool` SHALL become `"ask_user"`
- **AND** no gating on the prompt's `placement` SHALL be applied

### Requirement: The derived state survives the writers that clear currentTool

While a session has at least one pending prompt, a **live** event that would otherwise clear `currentTool` to `null` — `agent_start`, `agent_end`, or `tool_execution_end` — SHALL leave the session's `currentTool` as `"ask_user"`.

The reconciliation SHALL NOT be applied while the session is replaying. During replay `currentTool` SHALL remain purely event-derived, and the replay exit SHALL be the only place the registry is consulted for a replayed session. This keeps a stale registry entry from contaminating the stored value before the reconcile can prune it.

#### Scenario: Synthetic agent_start on bridge reconnect

- **WHEN** a session has a pending prompt
- **AND** a synthetic `agent_start` arrives (the bridge's mid-turn reconnect signal)
- **THEN** the session's `status` SHALL become `streaming`
- **AND** the session's `currentTool` SHALL remain `"ask_user"` rather than being cleared to `null`

#### Scenario: Agent ends while a prompt is still pending

- **WHEN** a session has a pending prompt and an `agent_end` arrives
- **THEN** the session's `status` SHALL become `idle`
- **AND** the session's `currentTool` SHALL remain `"ask_user"`

#### Scenario: Replayed events are not folded

- **WHEN** a session has a tracked pending prompt and is replaying
- **AND** a stored `agent_end` is processed during that replay
- **THEN** the session's `currentTool` SHALL be `null` from the event alone
- **AND** the derived value SHALL be applied only at the replay exit

#### Scenario: skipReplayInsert fast path is not folded

- **WHEN** a session has a pending prompt and is in the `skipReplayInsert` state
- **THEN** no pending-prompt reconciliation SHALL be applied on that path
- **AND** the replay exit SHALL establish the derived value instead

#### Scenario: No pending prompt leaves clearing behaviour unchanged

- **WHEN** a session has no pending prompt
- **AND** an `agent_start`, `agent_end`, or `tool_execution_end` event arrives
- **THEN** the session's `currentTool` SHALL be cleared to `null` exactly as before

### Requirement: Reconnect preserves edge-triggered consumers

A reconnect SHALL NOT cause the unread trigger or the `questionFirst` reorder to fire for a prompt that was already reflected in session state. A genuinely new prompt on a live session SHALL still fire both exactly once.

The reconnect message order — the pending `prompt_request` messages preceding the synthetic `agent_start` — is the invariant that makes this hold, and SHALL be asserted by an ordered replay test rather than assumed.

#### Scenario: Reconnect does not re-mark an already-seen prompt unread

- **WHEN** a session's `currentTool` is already `"ask_user"` from a pending prompt
- **AND** a synthetic `agent_start` arrives
- **THEN** the unread trigger SHALL NOT fire
- **AND** the `questionFirst` reorder SHALL NOT fire

#### Scenario: A new prompt on a live session still fires both triggers

- **WHEN** a session that is not replaying and has `currentTool: null` receives a `prompt_request`
- **AND** no browser is viewing the session
- **THEN** the session SHALL be marked unread
- **AND** the `questionFirst` reorder SHALL move it to the front of its tier

#### Scenario: The prompt_request writer evaluates the triggers itself

- **WHEN** a `prompt_request` sets `currentTool` to `"ask_user"` on a live session
- **THEN** the unread trigger and the `questionFirst` reorder SHALL be evaluated in that handler, under the same not-replaying and not-viewed gates as the forwarded-event path
- **AND** the handler SHALL capture its before-snapshot prior to its own write, so the edge semantics that prevent double-firing still hold
- **AND** correctness SHALL NOT depend on whether `tool_execution_start` or `prompt_request` arrives first

#### Scenario: Prompt arriving before its tool event still fires once

- **WHEN** a `prompt_request` arrives before the matching `tool_execution_start`
- **THEN** the unread and reorder triggers SHALL fire exactly once for that prompt
- **AND** the later `tool_execution_start` SHALL NOT fire them a second time

#### Scenario: Reconnect ordering is asserted, not assumed

- **WHEN** the reconnect sequence is replayed in the order `session_register` → `prompt_request` → `replay_complete` → `agent_start`
- **THEN** the session SHALL end with `currentTool: "ask_user"`
- **AND** the test SHALL fail if the `prompt_request` and `agent_start` steps are transposed, documenting the dependency on bridge message order

### Requirement: The derived state clears when the last pending prompt resolves

When a `prompt_dismiss` or `prompt_cancel` leaves a session with no tracked pending prompts, the system SHALL clear that session's `currentTool` to `null`. It SHALL NOT clear a `currentTool` naming a tool other than `"ask_user"`, and it SHALL NOT clear while other prompts for the session remain pending.

#### Scenario: Last prompt resolved

- **WHEN** a `prompt_dismiss` clears the only tracked prompt for a session whose `currentTool` is `"ask_user"`
- **THEN** the session's `currentTool` SHALL be set to `null` (not `undefined`)

#### Scenario: One of several prompts resolved

- **WHEN** a `prompt_cancel` clears one of two tracked prompts for a session
- **THEN** the session's `currentTool` SHALL remain `"ask_user"`

#### Scenario: A real tool is not stomped

- **WHEN** a `prompt_dismiss` empties the registry for a session whose `currentTool` is `"bash"`
- **THEN** the session's `currentTool` SHALL remain `"bash"`

#### Scenario: Prompt answered through the TUI

- **WHEN** a prompt is answered in the TUI rather than the dashboard
- **AND** the bridge emits the resulting `prompt_dismiss`
- **THEN** the session's `currentTool` SHALL be cleared as in the dismissed case

### Requirement: Every replay exit reconciles the registry and recomputes from it

On leaving the replaying state, the system SHALL treat the `prompt_request` messages received during that replay as an authoritative snapshot of the session's pending prompts, SHALL drop tracked entries absent from it, and SHALL then **re-derive** the session's `currentTool`. Pruning alone is insufficient: the derived value written during replay from a stale registry would otherwise survive the prune.

The re-derivation SHALL be: a non-empty reconciled registry yields `"ask_user"`; an empty one leaves the session's event-derived `currentTool` untouched. It SHALL NOT unconditionally write `null` on an empty registry. This is unambiguous precisely because replayed events are not folded, so the stored value at the replay exit is exactly what the events produced.

Both exits from the replaying state SHALL perform this — the `replay_complete` message and the replay safety timeout — and both SHALL be guarded so that only the first to fire acts. The operations SHALL occur in the order reconcile → recompute → drain, and the drain SHALL apply to the ephemeral collected promptId set only, never to the live pending-prompt registry that browser-refresh replay depends on.

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

- **WHEN** `replay_complete` never arrives and the replay safety timeout clears the replaying state
- **THEN** the reconcile and re-derivation SHALL run on that path too
- **AND** a stale entry SHALL NOT survive to keep the session unreapable

#### Scenario: A genuinely in-flight tool is not clobbered by the recompute

- **WHEN** a session's last replayed event was a `tool_execution_start` naming a non-`ask_user` tool
- **AND** the reconciled registry is empty
- **THEN** the recomputed `currentTool` SHALL remain that tool's name
- **AND** SHALL NOT be reset to `null`

#### Scenario: The two exits cannot race

- **WHEN** the safety timeout fires and a late `replay_complete` arrives afterwards
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

### Requirement: Pending-request registries are cleared when a session ends

When a session is unregistered, the system SHALL clear its entries in **both** pending-request registries — the PromptBus pending-prompt registry and the extension-UI request registry. Because both gate session reclamation, an entry outliving its session keeps a dead session permanently unreapable.

#### Scenario: Session ends with a pending prompt

- **WHEN** a session holding a tracked pending prompt is unregistered
- **THEN** its registry entries SHALL be removed
- **AND** `hasPendingPromptRequests(sessionId)` SHALL return `false`

#### Scenario: Session ends with a pending extension-UI request

- **WHEN** a session holding a tracked extension-UI request is unregistered
- **THEN** its entries SHALL be removed
- **AND** `hasPendingUiRequest(sessionId)` SHALL return `false`
- **AND** the session SHALL become eligible for reclamation

#### Scenario: Other sessions keep their prompts

- **WHEN** one session is unregistered
- **THEN** pending prompts tracked for other sessions SHALL be unaffected

### Requirement: The derived state is published without a new broadcast site

A `prompt_request` arriving while the session is replaying SHALL update session state without emitting a per-event broadcast, relying on the existing `replay_complete` broadcast to publish the accumulated `status` and `currentTool`.

#### Scenario: Prompt re-sent during reconnect replay

- **WHEN** a `prompt_request` arrives for a session in the replaying set
- **THEN** the session's `currentTool` SHALL be updated in the session manager
- **AND** no `session_updated` broadcast SHALL be emitted for that event
- **AND** the subsequent `replay_complete` broadcast SHALL carry `currentTool: "ask_user"`

#### Scenario: Live prompt is published

- **WHEN** a `prompt_request` arrives for a session that is not replaying
- **THEN** the resulting `currentTool` change SHALL reach browser subscribers
