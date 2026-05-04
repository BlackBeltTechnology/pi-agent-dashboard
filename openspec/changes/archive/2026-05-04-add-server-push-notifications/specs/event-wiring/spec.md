## MODIFIED Requirements

### Requirement: Co-located push and unread evaluation with separate predicates

The event evaluation block in `event-wiring.ts` SHALL be the single site where both unread and push decisions are made. Two separate `if` blocks SHALL evaluate `isUnreadTrigger(...)` (unread broadcast) and `isPushTrigger(...)` (push fan-out). Both share the same replay gate; push additionally uses 60s stale-view TTL.

#### Scenario: Push-worthy event → push dispatched
- **WHEN** `isPushTrigger(...)` returns true AND `!viewedSessionTracker.isViewedByAnyone(sessionId, {staleMs: 60_000})` AND not replay
- **THEN** `pushDispatcher?.fanout(sessionId, sessionAfter, event)` called

#### Scenario: Unread-only event (streaming→idle) → unread broadcast, no push
- **WHEN** `isUnreadTrigger(...)` true but `isPushTrigger(...)` false
- **THEN** unread bit set and broadcast; push NOT called

#### Scenario: Neither predicate matches → nothing
- **WHEN** both false
- **THEN** no unread broadcast, no push

#### Scenario: Viewed within 60s → push suppressed
- **WHEN** `isPushTrigger` matches AND `viewedSessionTracker` shows last view ≤60s ago
- **THEN** `fanout` NOT called

#### Scenario: Viewed >60s ago → push fires
- **WHEN** `isPushTrigger` matches AND last view >60s ago
- **THEN** `fanout` called

### Requirement: Optional push dispatcher dependency with session metadata

`EventWiringDeps` SHALL accept `pushDispatcher?: PushDispatcher`. When undefined, behavior SHALL be identical to pre-push code. `fanout` receives `sessionAfter` (from `sessionManager`) alongside `sessionId` and `event`. `viewedSessionTracker.isViewedByAnyone` SHALL support `{staleMs?: number}` option.

#### Scenario: Dispatcher absent
- **WHEN** `wireEvents(...)` without `pushDispatcher`
- **THEN** all event flow identical to pre-change code; no errors

#### Scenario: Dispatcher present
- **WHEN** `wireEvents(...)` with `pushDispatcher`
- **THEN** dispatcher invoked under push gating with `sessionAfter` passed
