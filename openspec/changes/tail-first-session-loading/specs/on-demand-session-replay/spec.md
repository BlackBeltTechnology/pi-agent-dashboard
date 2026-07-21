# on-demand-session-replay Delta Specification

## MODIFIED Requirements

### Requirement: On-demand session loading via server
When a browser subscribes to a session whose events are not in memory, the server SHALL load the session directly from pi's session file on disk using `SessionManager.open(sessionFile).getBranch()`, without routing through a bridge.

Delivery SHALL be tail-first: once the worker parse resolves, the server SHALL compute the tail window (budget-and-safe-cut rule, see `chat-history-pagination`) from the full converted event list and send it to all waiting subscribers as `event_replay` batches carrying `kind: "tail"` and `hasOlder`, without waiting for the full event list to be inserted into the in-memory buffer.

#### Scenario: Browser subscribes to evicted session
- **WHEN** a browser subscribes to session "abc" whose events are not in memory, and the session has a `sessionFile` path
- **THEN** the server SHALL send an immediate `event_replay { events: [], isLast: false }` to the browser, load the session file directly via `SessionManager.open(sessionFile).getBranch()`, convert entries via `replayEntriesAsEvents()`
- **AND** send the tail window to the browser as `event_replay { kind: "tail", …, isLast: true, hasOlder }` as soon as conversion completes

#### Scenario: Session file unavailable
- **WHEN** a browser subscribes to a session whose `sessionFile` does not exist, is corrupted, or is not set
- **THEN** the server SHALL send `event_replay { events: [], isLast: true }` and `session_updated { dataUnavailable: true }`

#### Scenario: Multiple browsers subscribe to same evicted session
- **WHEN** two browsers subscribe to the same evicted session before the load completes
- **THEN** the server SHALL deduplicate the load and deliver the tail window to both browsers

#### Scenario: Loaded events are buffered for future requests
- **WHEN** events are loaded on demand from disk
- **THEN** the server SHALL store the FULL converted event list in the in-memory event buffer so subsequent subscribes and `load_older` requests are served from memory without another disk load

### Requirement: Batch replay for on-demand loaded events
On-demand loaded events SHALL be delivered as batch `event_replay` messages, not as individual live `event` broadcasts. The subscriber-facing delivery SHALL be the tail window; the remainder of the loaded events SHALL be available via `load_older`.

The full-buffer insert SHALL yield to the event loop between bounded slices so inserting a large session (tens of MB) does not block the server. A `load_older` request arriving while the insert is in flight SHALL be answered after the insert completes.

#### Scenario: Server receives loaded events
- **WHEN** the server loads events from a session file
- **THEN** it SHALL send the tail window (`kind: "tail"`) to all waiting browsers and insert all events into the in-memory buffer in yielding chunks

#### Scenario: load_older during buffer fill waits for the fill
- **WHEN** a `load_older` arrives for a session whose cold-load buffer insert has not finished
- **THEN** the server SHALL answer the request after the insert completes, from the fully populated buffer

## ADDED Requirements

### Requirement: Cold-load stats reach the client independent of the tail window
Because the tail window omits older `stats_update` events, the server SHALL continue to extract session-level stats from the FULL loaded event list (`extractStatsFromEvents`) and broadcast them via `session_updated`, so header stat surfaces do not regress to window-local values on cold load.

#### Scenario: Header stats reflect the full session after cold load
- **WHEN** a cold load completes for a session whose tail window excludes earlier `stats_update` events
- **THEN** the `session_updated` broadcast SHALL carry stats extracted from the full event list
