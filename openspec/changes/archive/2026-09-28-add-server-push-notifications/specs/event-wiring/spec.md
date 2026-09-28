## ADDED Requirements

### Requirement: Unread trigger site is the single push hook
`stampUnreadIfTriggered` in `packages/server/src/event-wiring.ts` SHALL be the only place that decides to push. After `isUnreadTrigger` passes and no browser views the session, it SHALL compute `unreadEdge = session exists AND session.unread === false`, perform the existing unread update and broadcast when `unreadEdge` is true, and then, when the session exists, call `pushDispatcher?.fanout(sessionId, {eventType, after, payload, unreadEdge})` exactly once per invocation. No other code SHALL evaluate `isUnreadTrigger` to decide on a push. Replay events SHALL never reach the helper: the `event_forward` caller excludes sessions in `replayingSessions`, and the `prompt_request` branch runs only for live messages.

#### Scenario: Qualifying trigger on a read session
- **WHEN** an event satisfies `isUnreadTrigger(...)`, no browser views the session, the event is not a replay, and `unread` is `false`
- **THEN** `unread` SHALL become `true`
- **AND** `fanout` SHALL be called once with `unreadEdge: true`

#### Scenario: Qualifying trigger on an already-unread session
- **WHEN** the same kind of event arrives while `unread` is already `true`
- **THEN** `unread` SHALL stay `true` with no new broadcast
- **AND** `fanout` SHALL be called once with `unreadEdge: false`

#### Scenario: Double caller for one ask_user edge
- **WHEN** the `event_forward` path and the `prompt_request` branch both reach the helper for the same `ask_user` edge
- **THEN** exactly one of the two `fanout` calls SHALL carry `unreadEdge: true`

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

### Requirement: Optional push dispatcher dependency
`EventWiringDeps` SHALL accept an optional `pushDispatcher?: PushDispatcher`. Without it, the wiring SHALL behave exactly as before this change. Because `stampUnreadIfTriggered` returns early when `viewedSessionTracker` is absent, push SHALL require both dependencies, and the production wiring in `server.ts` SHALL pass the tracker whenever it passes a dispatcher.

#### Scenario: Dispatcher absent
- **WHEN** `wireEvents(...)` is called without `pushDispatcher`
- **THEN** event flow SHALL be identical to the pre-change path and no error SHALL be logged about a missing dispatcher

#### Scenario: Dispatcher present
- **WHEN** `wireEvents(...)` is called with both `pushDispatcher` and `viewedSessionTracker`
- **THEN** the dispatcher SHALL be invoked on every qualifying trigger with the correct `unreadEdge`

#### Scenario: Production wiring pairs the dependencies
- **WHEN** the server starts with `push.enabled: true`
- **THEN** `wireEvents` SHALL receive both `pushDispatcher` and `viewedSessionTracker`
