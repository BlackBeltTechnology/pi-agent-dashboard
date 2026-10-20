# Spec Delta

## MODIFIED Requirements

### Requirement: Unread trigger site is the single push hook
`stampUnreadIfTriggered` in `packages/server/src/event-wiring.ts` SHALL be the only place that decides to push. After `isUnreadTrigger` passes and no browser views the session, it SHALL compute `unreadEdge = session exists AND session.unread is not true` (`false` or absent — a session restored from legacy metadata carries no `unread` and is read), perform the existing unread update and broadcast when `unreadEdge` is true, and then, when the session exists, call `pushDispatcher?.fanout(sessionId, {eventType, after, payload, unreadEdge})` exactly once per invocation. No other code SHALL evaluate `isUnreadTrigger` to decide on a push. Replay events SHALL never reach the helper: the `event_forward` caller excludes replayed forwards (marked `replay: true`, or received in bridge replay mode), and the `prompt_request` branch calls it only for live messages — in bridge replay mode that branch only collects prompt ids for the exit reconcile. The legacy notify-shaped `prompt_request` path is outside this rule.

#### Scenario: Qualifying trigger on a read session
- **WHEN** an event satisfies `isUnreadTrigger(...)`, no browser views the session, the event is not a replay, and `unread` is `false`
- **THEN** `unread` SHALL become `true`
- **AND** `fanout` SHALL be called once with `unreadEdge: true`

#### Scenario: Qualifying trigger on an already-unread session
- **WHEN** the same kind of event arrives while `unread` is already `true`
- **THEN** `unread` SHALL stay `true` with no new broadcast
- **AND** `fanout` SHALL be called once with `unreadEdge: false`

#### Scenario: Double caller for one ask_user edge
- **WHEN** the `event_forward` path and the `prompt_request` branch both reach the helper for the same `ask_user` edge, in either order
- **THEN** `fanout` SHALL be called exactly once, with `unreadEdge: true`, because the second caller sees `currentTool` already `"ask_user"` and `isUnreadTrigger` is false

#### Scenario: prompt_request caller without payload
- **WHEN** the `prompt_request` branch calls the helper with `eventType: "prompt_request"` and no payload, and `after.currentTool` is `"ask_user"`
- **THEN** `fanout` SHALL receive `after` so the payload builder can classify the trigger as "waiting for input"

#### Scenario: Unknown session → no fan-out
- **WHEN** a qualifying trigger arrives for a session id with no session record
- **THEN** `fanout` SHALL NOT be called

#### Scenario: Predicate fails → neither consumer fires
- **WHEN** `isUnreadTrigger(...)` returns false, or a browser views the session
- **THEN** `unread` SHALL NOT change and `fanout` SHALL NOT be called

#### Scenario: Replay event → neither consumer fires
- **WHEN** a replay event reaches the `event_forward` path and would satisfy the trigger
- **THEN** `stampUnreadIfTriggered` SHALL NOT be invoked and `fanout` SHALL NOT be called

#### Scenario: Replay event after the old 5 s mark → neither consumer fires
- **WHEN** a replayed event that would satisfy the trigger arrives 6 s after the register, while replay events have kept arriving
- **THEN** `stampUnreadIfTriggered` SHALL NOT be invoked and `fanout` SHALL NOT be called

## ADDED Requirements

### Requirement: A marked replayed event is never live
An `event_forward` carrying `replay: true` SHALL be handled exactly as an event received in bridge replay mode, whatever the timers say: no live broadcast, unread, push, `lastActivityAt`, card order, liveness stamp, or OpenSpec detection. A marked event after the replay exit SHALL reopen replay mode for that register, so the next exit flushes it. When the register skipped the wipe, marked events SHALL NOT be inserted until the next register.

#### Scenario: Marked event after an idle exit stays replayed
- **WHEN** a bridge registers, sends nothing for 6 s (idle exit runs), then forwards `event_forward { replay: true }` events that would satisfy the unread trigger
- **THEN** none of them SHALL mark the session unread, call `fanout`, change `lastActivityAt`, or be broadcast as live

#### Scenario: Marked events after a cap exit still reach the browser
- **WHEN** a marked replay runs for 70 s, so the cap exit runs before its last events, and then `replay_complete` arrives
- **THEN** the subscribed browser SHALL receive every stored replayed event through a replay exit flush
- **AND** none of them SHALL be handled as live

#### Scenario: Marked historical change edit raises no suggestion
- **WHEN** a marked `tool_execution_start` writing `openspec/changes/change-b/proposal.md` arrives 70 s after the register
- **THEN** OpenSpec activity detection SHALL NOT run for it

#### Scenario: Skipped replay never re-inserts marked events
- **WHEN** a register skipped the wipe and marked replayed events keep arriving after the replay exit
- **THEN** none of them SHALL be inserted into the event store

#### Scenario: Unmarked events after replay_complete are live
- **WHEN** a bridge sends `replay_complete` and then an unmarked `event_forward`
- **THEN** the event SHALL be handled as live

### Requirement: Bridge replay mode spans the whole replay
After a `session_register`, the server SHALL keep the session in bridge replay mode until `replay_complete` arrives, until no bridge message for that session has been processed for 5 s (idle exit), or until 60 s have passed since the register (cap exit), whichever is first. An unmarked `event_forward` received in replay mode SHALL be treated as replayed; one received after the exit SHALL be treated as live. Every exit SHALL run the same exit work.

#### Scenario: Unmarked replay longer than 5 s stays in replay mode
- **WHEN** a bridge that does not mark replayed events registers and forwards events continuously, with no gap of 5 s, for longer than 5 s before `replay_complete`
- **THEN** none of those events SHALL be broadcast as live, mark the session unread, change `lastActivityAt`, or run OpenSpec activity detection

#### Scenario: Idle exit
- **WHEN** a bridge registers, forwards some events, and then sends nothing for that session for 5 s without `replay_complete`
- **THEN** the server SHALL leave replay mode and run the same exit work as on `replay_complete`

#### Scenario: Cap exit
- **WHEN** 60 s pass after a register without `replay_complete`, even though events keep arriving
- **THEN** the server SHALL leave replay mode, run the same exit work as on `replay_complete`, and log a warning

### Requirement: A busy server does not cause an idle exit
The idle period SHALL be measured from the last processed bridge message for the session (any message type). When the idle exit becomes due, the server SHALL let input already read from the socket be handled once more and re-check before leaving replay mode. This is best effort for unmarked events; marked events do not depend on it.

#### Scenario: Event loop blocked mid-replay
- **WHEN** the server is blocked for 6 s in the middle of a replay while the bridge keeps sending replayed events
- **THEN** after the block the server SHALL handle the input already read before deciding the idle exit
- **AND** SHALL re-arm the idle period when that input contained a bridge message for the session

#### Scenario: Prompt re-sends keep the replay alive
- **WHEN** the bridge sends no `event_forward` for 5 s but keeps sending `prompt_request` re-sends inside its replay
- **THEN** the server SHALL NOT take the idle exit

### Requirement: One replay exit timer per session
Each session SHALL have at most one pending replay exit (idle or cap) at a time. A new `session_register` SHALL cancel the pending exit of any earlier register for that session before starting its own, and `replay_complete` SHALL cancel the pending exit. Only the first exit of a replay SHALL act; a later exit for the same replay SHALL be a no-op.

#### Scenario: Earlier register's timer does not end a later replay
- **WHEN** a bridge registers, completes its replay, re-registers 4 s later, and forwards an unmarked replayed event 1.3 s after the second register
- **THEN** the session SHALL still be in replay mode when that event arrives
- **AND** the event SHALL NOT be broadcast as live

#### Scenario: replay_complete cancels the pending exit
- **WHEN** `replay_complete` arrives before the idle or cap exit
- **THEN** no later idle or cap exit SHALL run for that replay

#### Scenario: Late replay_complete after an idle exit is a no-op
- **WHEN** an idle exit has run, no bridge event arrived since, and `replay_complete` for that replay arrives afterwards
- **THEN** no second flush or status broadcast SHALL be sent

### Requirement: Unregister ends the replay and releases its state
When a session is unregistered or removed while in bridge replay mode, the server SHALL cancel its pending exit timers, stop any replay-exit flush still sending, stop waiting subscribers' keepalives, and send each of them a terminal `event_replay { isLast: true }` built from the stored events. Per-session replay state (timers, skip mark, fingerprint, register generation) SHALL then be released.

#### Scenario: Unregister during replay
- **WHEN** a session is unregistered while in bridge replay mode with a browser waiting for its replay
- **THEN** no idle or cap exit SHALL run for it afterwards
- **AND** the waiting browser SHALL receive an `event_replay` batch with `isLast: true`

### Requirement: Every replay exit logs its cause
Every replay exit SHALL log one line naming the session and the cause: `complete`, `idle`, `cap`, or `unregister`. An `idle` or `cap` exit SHALL be logged at warning level.

#### Scenario: Cap exit is logged as a warning
- **WHEN** a replay ends through the cap exit
- **THEN** the server SHALL log a warning naming the session id and cause `cap`
