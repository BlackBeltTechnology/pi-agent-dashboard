## MODIFIED Requirements

### Requirement: Unread-trigger evaluation site is the single push hook
The unread-trigger evaluation block in `event-wiring.ts` SHALL be the single point in the codebase where "push to disconnected devices" decisions are made. The block evaluates `isUnreadTrigger(...)` once and dispatches BOTH the unread-stripes broadcast AND the push fan-out from the same gated `if` body. New consumers of "is this event user-relevant?" SHALL co-locate at this site rather than re-evaluating the predicate elsewhere.

#### Scenario: One predicate, two consumers
- **WHEN** an event arrives that satisfies `isUnreadTrigger(...)` AND `!viewedSessionTracker.isViewedByAnyone(sessionId)` AND not in replay
- **THEN** the unread bit SHALL be set on the session
- **AND** `pushDispatcher?.fanout(sessionId, event)` SHALL be called within the same gated branch

#### Scenario: Predicate fails → neither consumer fires
- **WHEN** `isUnreadTrigger(...)` returns false
- **THEN** the unread bit SHALL NOT change
- **AND** `pushDispatcher` SHALL NOT be called

### Requirement: Optional push dispatcher dependency
`EventWiringDeps` SHALL accept an optional `pushDispatcher?: PushDispatcher` field. When undefined, the wiring SHALL behave identically to its pre-push behavior — no fan-out, no errors. This mirrors the existing `viewedSessionTracker?` pattern and keeps tests that don't exercise push lean.

#### Scenario: Dispatcher absent
- **WHEN** `wireEvents(...)` is called without `pushDispatcher` in deps
- **THEN** all event flow SHALL behave identically to the pre-change code path
- **AND** no errors SHALL be logged about a missing dispatcher

#### Scenario: Dispatcher present
- **WHEN** `wireEvents(...)` is called with `pushDispatcher` in deps
- **THEN** the dispatcher SHALL be invoked at the unread-trigger site under the gating defined in the `push-notifications` capability
