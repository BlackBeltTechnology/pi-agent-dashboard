# dashboard-plugin-session-side-channel-store Specification

## Purpose

Client-side module-level per-session stores that give dashboard plugins read access to a session's event stream and to arbitrary session-scoped key/value data, as a side channel from the shell's reducer-based `SessionState`. The shell publishes; plugins subscribe. Snapshots are stable references so React's `useSyncExternalStore` re-renders only on real mutations, and publish paths are isolated per session.

## Requirements

### Requirement: Per-session event publish and subscription

The event store SHALL let the shell publish events for a session and SHALL let subscribers be notified when a session's events change.

#### Scenario: Publishing a single event extends the array and notifies

- **WHEN** `publishSessionEvent(sessionId, event)` is called
- **THEN** `getSessionEvents(sessionId)` returns an array containing the previously stored events followed by the new event
- **AND** every callback registered via `subscribeSessionEvents(sessionId, cb)` is invoked with no arguments

#### Scenario: Subscribing and unsubscribing

- **WHEN** `subscribeSessionEvents(sessionId, cb)` is called
- **THEN** it returns an unsubscribe function
- **AND** invoking the unsubscribe function removes `cb` so it is no longer notified for that session

#### Scenario: Notify with no subscribers is a no-op

- **WHEN** `publishSessionEvent(sessionId, event)` or `clearSessionEvents(sessionId)` runs for a session that has no registered subscribers
- **THEN** no callback is invoked and no error is thrown

### Requirement: Stable event snapshot references

The event store SHALL return a stable array reference that changes only when the session's events actually mutate, so `useSyncExternalStore` consumers re-render only on real changes.

#### Scenario: Unknown session returns the shared frozen empty array

- **WHEN** `getSessionEvents(sessionId)` is called for a session that has never been published to
- **THEN** it returns the frozen `EMPTY_EVENTS` array
- **AND** repeated calls return the same reference

#### Scenario: Reference changes on every real publish

- **WHEN** `publishSessionEvent(sessionId, event)` is called
- **THEN** `getSessionEvents(sessionId)` returns a new frozen array reference distinct from the one returned before the publish

#### Scenario: Returned arrays are frozen

- **WHEN** an event array is stored via publish
- **THEN** the array returned by `getSessionEvents` is frozen and cannot be mutated by consumers

### Requirement: Batch event publish

The event store SHALL support publishing a batch of events in a single array rebuild and a single notification, and SHALL treat an empty batch as a no-op.

#### Scenario: Batch publish appends all events with one notification

- **WHEN** `publishSessionEvents(sessionId, newEvents)` is called with a non-empty array
- **THEN** `getSessionEvents(sessionId)` returns the previous events followed by all of `newEvents`
- **AND** subscribers are notified exactly once for the whole batch

#### Scenario: Empty batch preserves the stable reference

- **WHEN** `publishSessionEvents(sessionId, [])` is called with an empty array
- **THEN** the stored array reference is unchanged
- **AND** no subscriber is notified

### Requirement: Clear events on session reset

The event store SHALL remove a session's events on clear and notify subscribers, and SHALL skip work when the session holds no events.

#### Scenario: Clearing an existing session resets and notifies

- **WHEN** `clearSessionEvents(sessionId)` is called for a session that has stored events
- **THEN** `getSessionEvents(sessionId)` returns the frozen `EMPTY_EVENTS` array
- **AND** subscribers for that session are notified

#### Scenario: Clearing an unseen session is a no-op

- **WHEN** `clearSessionEvents(sessionId)` is called for a session that has never been published to
- **THEN** no subscriber is notified

### Requirement: Per-session isolation

The stores SHALL keep events, data, and subscribers isolated per session so operations on one session do not affect another.

#### Scenario: Publishing to one session does not affect another

- **WHEN** `publishSessionEvent(sessionA, event)` is called
- **THEN** `getSessionEvents(sessionB)` for a different session is unchanged
- **AND** subscribers registered for `sessionB` are not notified

### Requirement: Per-session key/value data store

The data store SHALL let the shell publish arbitrary session-scoped values under string keys and SHALL let plugins subscribe to a single `(sessionId, key)` pair.

#### Scenario: Publishing a data value stores it and notifies pair subscribers

- **WHEN** `publishSessionData(sessionId, key, value)` is called
- **THEN** `getSessionData(sessionId, key)` returns the stored `value` verbatim
- **AND** callbacks registered via `subscribeSessionData(sessionId, key, cb)` for that exact pair are invoked with no arguments

#### Scenario: Reading an unknown key returns undefined

- **WHEN** `getSessionData(sessionId, key)` is called for a session or key that has not been published
- **THEN** it returns `undefined`

#### Scenario: Subscribing to a pair returns an unsubscribe function

- **WHEN** `subscribeSessionData(sessionId, key, cb)` is called
- **THEN** it returns an unsubscribe function that removes `cb` from that `(sessionId, key)` pair

### Requirement: All-sessions-for-a-key subscription

The data store SHALL let a subscriber react to every publish for a given key across all sessions, receiving the session id and value.

#### Scenario: Key subscriber fires on publish for any session

- **WHEN** `subscribeSessionDataKey(key, cb)` is registered and `publishSessionData(sessionId, key, value)` is called for any session
- **THEN** `cb` is invoked with `(sessionId, value)`

#### Scenario: Clearing a session notifies key subscribers with undefined

- **WHEN** `clearSessionData(sessionId)` is called for a session that holds one or more keys
- **THEN** for every key the session held, pair subscribers are notified
- **AND** `subscribeSessionDataKey` subscribers for those keys are invoked with `(sessionId, undefined)`

#### Scenario: Clearing an unseen session is a no-op

- **WHEN** `clearSessionData(sessionId)` is called for a session with no stored data
- **THEN** no pair subscriber and no key subscriber is invoked
