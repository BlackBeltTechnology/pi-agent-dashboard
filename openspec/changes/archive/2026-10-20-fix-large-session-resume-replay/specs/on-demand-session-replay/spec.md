# Spec Delta

## MODIFIED Requirements

### Requirement: On-demand session loading via server
When a browser subscribes to a session whose events are not in memory, the server SHALL load the session directly from pi's session file on disk using `SessionManager.open(sessionFile).getBranch()`, without routing through a bridge. While a bridge is replaying the session (bridge replay mode), the server SHALL NOT start this load; the bridge replay supplies the events.

#### Scenario: Browser subscribes to evicted session
- **WHEN** a browser subscribes to session "abc" whose events are not in memory, the session has a `sessionFile` path, and no bridge is replaying the session
- **THEN** the server SHALL send an immediate `event_replay { events: [], isLast: false }` to the browser, load the session file directly via `SessionManager.open(sessionFile).getBranch()`, convert entries via `replayEntriesAsEvents()`, store in the event buffer, and send `event_replay { events, isLast: true }` to the browser

#### Scenario: Browser subscribes during a bridge replay
- **WHEN** a browser subscribes to session "abc" whose events are not in memory while a bridge is replaying it
- **THEN** the server SHALL send an immediate `event_replay { events: [], isLast: false }`, SHALL NOT load the session file, and SHALL deliver the events through the replay exit flush

#### Scenario: Session file unavailable
- **WHEN** a browser subscribes to a session whose `sessionFile` does not exist, is corrupted, or is not set
- **THEN** the server SHALL send `event_replay { events: [], isLast: true }` and `session_updated { dataUnavailable: true }`

#### Scenario: Multiple browsers subscribe to same evicted session
- **WHEN** two browsers subscribe to the same evicted session before the load completes
- **THEN** the server SHALL deduplicate the load and deliver loaded events to both browsers

#### Scenario: Loaded events are buffered for future requests
- **WHEN** events are loaded on demand from disk
- **THEN** the server SHALL store them in the in-memory event buffer so subsequent browser subscribes do not trigger another load

## ADDED Requirements

### Requirement: The bridge replay-exit flush is windowed
When a bridge replay ends (`replay_complete`, idle exit, cap exit) and a flush is pending for the session, the server SHALL send each browser subscriber exactly one `session_state_reset` followed by the stored events, bounded by the configured window the way a subscribe-time full replay is (with `history_window` when a window applies), ending with `isLast: true`. In-process subscribers SHALL keep receiving the full stream. A flush is pending from a wipe until one completes.

#### Scenario: Large replay flush is windowed
- **WHEN** a bridge replay of 3,000 events that compaction does not reduce ends with `maxReplayEvents` set to 2,000 and a browser subscribed
- **THEN** that browser SHALL receive exactly one `session_state_reset`, a `history_window` message, and `event_replay` batches holding at most the window
- **AND** no single `event_replay` frame SHALL hold all 3,000 events

#### Scenario: Windowing disabled
- **WHEN** `maxReplayEvents` is `0` and a bridge replay ends
- **THEN** the browser SHALL receive one `session_state_reset` and then all stored events in batches, with no `history_window`, even when the first stored seq is above 1

#### Scenario: Empty store still ends the wait
- **WHEN** a bridge replay ends with nothing stored and a browser is waiting for it
- **THEN** the browser SHALL receive `event_replay { events: [], isLast: true }`

#### Scenario: In-process subscriber gets the full stream
- **WHEN** a bridge replay of 3,000 events ends with `maxReplayEvents` set to 2,000 and an in-process subscriber is attached
- **THEN** that subscriber SHALL receive all 3,000 events

#### Scenario: Skipped wipe with no pending flush sends nothing
- **WHEN** the register skipped the wipe, no flush is pending, and the bridge replay ends
- **THEN** no `event_replay` flush SHALL be sent for that replay

### Requirement: A superseded replay-exit flush stops and unmutes
A replay-exit flush still sending batches when the same session registers again, or is unregistered, SHALL stop before its next batch and SHALL release the browser from replay suppression so live events reach it again. No batch from the earlier flush SHALL reach a browser after the new register's `session_state_reset`. The flush stays pending: the next replay exit SHALL send a complete flush, even when the new register skipped the wipe.

#### Scenario: Re-register while a flush is draining
- **WHEN** a replay-exit flush is sending batches and the bridge registers the session again
- **THEN** the browser SHALL receive no batch from the earlier flush after the new `session_state_reset`

#### Scenario: Abort followed by a skipped register
- **WHEN** a replay-exit flush is aborted by a re-register that skips the wipe
- **THEN** the next replay exit SHALL send the full flush ending with `isLast: true`
- **AND** the browser SHALL receive live events after that flush
