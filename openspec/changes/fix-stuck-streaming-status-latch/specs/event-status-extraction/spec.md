## ADDED Requirements

### Requirement: Session status reconciled against reported agent liveness

Session status SHALL NOT be derived solely from the `agent_start`/`agent_end` run-boundary pair. The system SHALL accept a bridge-reported agent-liveness truth (`agentRunning: boolean`) as a distinct reconcile input and derive a status update from it when — and only when — it disagrees with the session's current status.

Reconcile semantics, defined over the FULL status domain (`streaming`, `idle`, `active`, `ended`) — not a `streaming`/`idle` binary:

- `agentRunning === false` while current status is `streaming` SHALL produce an update setting `status` to `idle` and clearing `currentTool` to `null`.
- `agentRunning === true` while current status is `idle` or `active` SHALL produce an update setting `status` to `streaming` and SHALL leave `currentTool` unchanged. (Asymmetric with the `→ idle` direction on purpose: a not-running agent cannot be inside a tool, but a running one may be, and a tool event delivered after the lost `agent_start` may legitimately have stamped `currentTool`.)
- Current status `active` with `agentRunning === false` SHALL produce no update. `active` is the routine post-registration resting state; correcting it would rewrite status on every beat of every idle session.
- Current status `ended` SHALL produce no update in EITHER direction. `ended` is terminal; a heartbeat racing session teardown MUST NOT resurrect the session to `streaming`.
- Agreement between the reported liveness and the current status SHALL produce no update (`null`), so a steady-state session emits no churn.

Application-side guards (the reconcile is a new writer on an established path and inherits its conventions):

- A reconcile SHALL NOT be applied while the session is replaying. Replay-exit already recomputes status from the replayed events, which is better ground truth than a single beat.
- When a pending prompt request is outstanding for the session, the reconcile SHALL correct `status` but SHALL NOT clear `currentTool`, matching the existing `hasPendingPrompt` protection of a live `ask_user`.

The reconcile input SHALL be carried separately from `agent_start`/`agent_end` so that run-boundary side effects (auto-naming, follow-up drain, retry disposition) stay anchored to real run boundaries and are never triggered by a correction.

#### Scenario: Stale streaming corrected to idle

- **WHEN** a reconcile reporting `agentRunning: false` is extracted for a session whose current status is `streaming`
- **THEN** the update sets `status` to `idle`
- **AND** clears `currentTool` to `null`

#### Scenario: Missed agent_start corrected to streaming

- **WHEN** a reconcile reporting `agentRunning: true` is extracted for a session whose current status is `idle` or `active`
- **THEN** the update sets `status` to `streaming`
- **AND** `currentTool` is left unchanged

#### Scenario: Reconcile agreeing with current status is inert

- **WHEN** a reconcile reporting `agentRunning: false` is extracted for a session whose current status is already `idle`
- **THEN** the result is `null` and no session fields change

#### Scenario: Active session with an idle agent is inert

- **WHEN** a reconcile reporting `agentRunning: false` is extracted for a session whose current status is `active`
- **THEN** the result is `null` and no session fields change

#### Scenario: Ended session is never resurrected

- **WHEN** a reconcile reporting `agentRunning: true` is extracted for a session whose current status is `ended`
- **THEN** the result is `null` and the session remains `ended`

#### Scenario: Reconcile during replay is not applied

- **GIVEN** the session is currently replaying
- **WHEN** a reconcile reporting `agentRunning: false` arrives for a session whose status is `streaming`
- **THEN** no status update is applied and no `session_updated` is broadcast

#### Scenario: Reconcile preserves a live ask_user

- **GIVEN** a pending prompt request is outstanding for the session and `currentTool` is `ask_user`
- **WHEN** a reconcile corrects the session from `streaming` to `idle`
- **THEN** `status` becomes `idle`
- **AND** `currentTool` remains `ask_user`

#### Scenario: Reconcile does not carry run-boundary meaning

- **WHEN** a reconcile corrects a session from `streaming` to `idle`
- **THEN** no `agent_end` event is recorded in the session transcript
- **AND** the auto-session-namer, the follow-up-queue drain, and the retry-tracker disposition are not invoked

#### Scenario: Absent liveness report leaves behaviour unchanged

- **WHEN** no `agentRunning` value is reported (an older bridge)
- **THEN** status derivation behaves exactly as it did before this change

### Requirement: Reconcile-driven correction is observable

A reconcile that produces a status update SHALL be logged with the session id, the previous status, and the corrected status, because it is evidence that a run-boundary event was lost in transport. A reconcile that produces no update SHALL NOT log.

#### Scenario: Correcting reconcile logs

- **WHEN** a reconcile changes a session's status from `streaming` to `idle`
- **THEN** a log line records the session id, the previous status, and the corrected status

#### Scenario: Inert reconcile is silent

- **WHEN** a reconcile agrees with the current status
- **THEN** nothing is logged

## MODIFIED Requirements

### Requirement: Unread-attention classification

The system SHALL classify whether an event flips a session to unread, based on the before/after status-and-tool snapshot and the event payload, returning `true` only for moments that demand the user's attention and `false` otherwise. The "not currently viewed" gate is the caller's responsibility.

A status transition produced by a liveness reconcile SHALL NOT be classified as an unread trigger, even when it matches the `streaming` → `idle` shape. A reconcile is a correction of stale state, not a finished turn — it carries no evidence of *when* the turn ended or whether anything was produced.

This is a deliberate trade-off, not an impossibility claim: when only the `agent_end` was lost, the turn's output events WERE delivered, so there is genuinely unread content and no stripe will ever be stamped for it. Accepted, because the alternative — stamping unread from a correction — would fire an attention signal at an arbitrary later moment (up to one heartbeat interval after the fact, or on a reconnect), and because the status quo for exactly this case is a permanently stuck `Thinking…` card, which is also stripeless and additionally wrong.

Because the exemption is structural (the reconcile path never enters the classifier), it is pinned by a wiring-level test rather than a `isUnreadTrigger` unit test.

#### Scenario: Turn finished

- **WHEN** the session status transitions from `streaming` to `idle` or from `streaming` to `active`
- **THEN** the event is classified as an unread trigger (`true`)

#### Scenario: Input requested

- **WHEN** `currentTool` becomes `ask_user` and was not previously `ask_user`
- **THEN** the event is classified as an unread trigger (`true`)

#### Scenario: Agent ended with error

- **WHEN** the event type is `agent_end` and its payload has a truthy `error` field
- **THEN** the event is classified as an unread trigger (`true`)

#### Scenario: Reconcile-driven settle is not unread

- **WHEN** a liveness reconcile transitions the session from `streaming` to `idle`
- **THEN** the transition is not an unread trigger (`false`)
- **AND** the session's existing unread state is left untouched

#### Scenario: Ordinary work is not unread

- **WHEN** the event is none of the above (e.g. `message_end`, `tool_execution_*`, `model_select`, or git/process noise)
- **THEN** the event is not an unread trigger (`false`)
