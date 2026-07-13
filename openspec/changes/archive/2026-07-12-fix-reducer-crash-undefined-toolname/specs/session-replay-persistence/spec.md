## ADDED Requirements

### Requirement: Rehydrate is fault-isolated from malformed cached events

Rehydrating a session from the durable IndexedDB replay cache SHALL NOT be able to crash
the application. Because the rehydrate re-reduce runs at App level — above the chat view
error boundary — an uncaught throw while re-reducing a cached event would unmount the
whole React root. The replay cache is an optimization only: any failure to reconstruct
state from it SHALL degrade to a full replay, exactly as a cache miss does.

`rehydrateSession` SHALL isolate the per-entry re-reduce so that a throw for one session
discards that session's cache entry and yields a cache-miss result (caller subscribes
with `lastSeq: 0`, full replay) rather than propagating the error.

#### Scenario: A poisoned cache entry falls back to full replay

- **GIVEN** a durable replay-cache entry for a session whose payload contains an event
  that makes the reducer throw (e.g. a `tool_execution_start` with undefined `toolName`,
  absent the reducer's own tolerance)
- **WHEN** the client cold-loads that session and attempts to rehydrate
- **THEN** the rehydrate SHALL NOT throw or unmount the app
- **AND** it SHALL discard the offending session's cache entry
- **AND** it SHALL return a cache-miss result so the caller performs a full replay
  (`lastSeq: 0`)
- **AND** it SHALL emit a single diagnostic log identifying the fallback

#### Scenario: A healthy cache entry still delta-rehydrates

- **GIVEN** a replay-cache entry whose payload re-reduces without error
- **WHEN** the client cold-loads that session
- **THEN** rehydrate SHALL paint the reduced state and return the persisted cursor for a
  delta subscribe, unchanged from current behaviour
