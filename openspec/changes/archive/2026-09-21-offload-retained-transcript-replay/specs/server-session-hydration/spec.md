# server-session-hydration — delta

## ADDED Requirements

### Requirement: Retained remote-transcript hydration runs off the main event loop

Hydration of a session whose events come from a RETAINED REMOTE TRANSCRIPT
(rather than a local session file) SHALL perform its read, parse and event
materialization off the main event loop, under the same governance as
local-file hydration: the same `DashboardConfig.sessions.useLoadWorker` switch,
the same in-process fallback on worker spawn failure / crash / timeout, and the
same cancellation semantics.

The events produced SHALL be identical to the events the in-process projection
produces for the same transcript bytes and the same known context window, so a
remote session renders as the machine it came from would render it.

Concurrent cold subscribes to the same retained session SHALL be served by a
SINGLE hydration. The server SHALL NOT answer one of them with an empty replay
because another is in flight, and SHALL NOT ingest the same transcript more
than once.

#### Scenario: Retained hydration does not block the loop

- **WHEN** a client cold-subscribes to a remote-origin session whose retained
  transcript is large (at least the observed maximum of ~44 MB)
- **THEN** the server SHALL continue to serve HTTP requests and WebSocket
  frames while that transcript is read, parsed and replayed
- **AND** the main-thread time attributable to that hydration SHALL be
  materially lower than the pre-change synchronous path

#### Scenario: The hydration heartbeat keeps firing

- **WHEN** a retained hydration is in flight
- **THEN** the non-terminal `event_replay` heartbeat SHALL continue to reach
  every live subscriber for the duration
- **AND** the subscriber SHALL NOT be shown a false empty state
- **AND** the heartbeat SHALL be stopped on every exit path of the hydration,
  including failure

#### Scenario: Text-fed replay matches file-fed replay

- **WHEN** the same transcript bytes are hydrated once as a retained transcript
  and once as a local session file
- **THEN** the resulting event arrays SHALL be equal
- **AND** this SHALL hold for a transcript whose first line carries a byte-order
  mark or leading whitespace

#### Scenario: Worker unavailable falls back in-process

- **WHEN** the worker cannot be spawned, times out, or crashes during a
  retained hydration
- **THEN** the server SHALL hydrate that retained transcript in-process for
  that request
- **AND** the `event_replay` SHALL still be emitted with correct, uncorrupted
  events

#### Scenario: useLoadWorker disabled

- **WHEN** `DashboardConfig.sessions.useLoadWorker` is `false`
- **THEN** retained hydration SHALL run in-process exactly as on the
  pre-offload path

#### Scenario: Unsubscribing cancels an in-flight retained hydration

- **WHEN** the last subscriber leaves a session whose retained hydration has not
  yet resolved
- **THEN** that hydration SHALL be cancelled on the same path local hydration
  is cancelled on
- **AND** the cancelled job's events SHALL NOT be inserted into the event store
  nor broadcast

#### Scenario: A second concurrent subscriber joins the hydration in flight

- **WHEN** a client cold-subscribes to a remote-origin session while another
  subscriber's retained hydration is still running
- **THEN** only one hydration SHALL run for that session
- **AND** the transcript SHALL be inserted into the event store exactly once,
  so neither subscriber sees duplicated messages
- **AND** the joining subscriber SHALL receive the full replay when that
  hydration completes
- **AND** it SHALL NOT receive a terminal empty replay, nor have the session
  marked as having unavailable data, on account of the other subscriber
- **AND** it SHALL keep receiving the heartbeat until that hydration settles

#### Scenario: A failed hydration still releases its followers

- **WHEN** the single in-flight retained hydration fails
- **THEN** every subscriber waiting on it SHALL stop receiving heartbeats
- **AND** a later cold subscribe SHALL be able to start a fresh hydration

### Requirement: The retained read contract is unchanged by the offload

Moving the retained read, parse and replay off the main thread SHALL NOT change
any observable result of the retained read.

The read SHALL still report exactly one of `complete`, `incomplete`, or
`absent`; SHALL still return the retained lines in the order the origin held
them; and SHALL still never throw — including when the stored bytes are
malformed or hostile, and including when the store refuses the session id,
which SHALL continue to read as `absent`.

A parse or replay failure SHALL leave the reported state intact and yield no
events, rather than downgrading a transferred transcript to `absent`.

A read that overlaps a concurrent write SHALL NOT report `complete` over
content that predates the completion. Reporting `incomplete` for a transcript
that has just become complete is acceptable; the next read corrects it.

#### Scenario: A refused session id still reads as absent

- **WHEN** the retention store refuses a hostile session id
- **THEN** the read SHALL resolve with no entries, no events, and state
  `absent`
- **AND** SHALL NOT throw

#### Scenario: A malformed transcript keeps its state on hydration

- **WHEN** replay of a retained transcript fails on malformed content
- **THEN** the hydration SHALL resolve with no events and the state the
  transfer recorded (`complete` or `incomplete`)
- **AND** the session SHALL NOT be marked as having unavailable data

#### Scenario: A missing completion marker reads as incomplete, not absent

- **WHEN** retained content exists but no completion marker does
- **THEN** the read SHALL report `incomplete`
- **AND** an unreadable or missing marker SHALL never be reported as `absent`

#### Scenario: A concurrent append never reports complete over stale content

- **WHEN** the retained transcript is appended to and marked complete, or is
  restarted and rewritten shorter, while a read of it is in flight
- **THEN** the read SHALL NOT report `complete` alongside content that predates
  that write

#### Scenario: The HTTP read is unchanged

- **WHEN** a client GETs `GET /api/sessions/:id/retained-transcript`
- **THEN** the response body SHALL be the same as before the offload for the
  same stored bytes
- **AND** the entries SHALL still be returned in origin order with the state

### Requirement: Retained hydration is measurable

Every retained hydration that reaches the parse-and-replay stage SHALL record a
hydration timing sample into the same bounded ring buffer that local hydration
uses, so `/api/health` can answer "is hydration slow for remote sessions?" at
runtime. A read that short-circuits as `absent` SHALL NOT record a sample — the
ring is small, and no-op reads evicting real hydrations would defeat the
question.

The recorded byte count SHALL be the transcript's true size in bytes, so it is
comparable with the local path's sample.

Recording SHALL NOT alter the result returned to the hydration caller, and a
failure in the measurement path SHALL NOT propagate to the caller.

#### Scenario: A retained hydration records a sample

- **WHEN** a retained hydration completes, successfully or not
- **THEN** a sample carrying at least the session id, wall time, byte size,
  entry count, and event count SHALL be recorded
- **AND** the sample SHALL appear in `/api/health`'s `hydration` array

#### Scenario: An absent read records nothing

- **WHEN** a retained read finds no transcript and short-circuits
- **THEN** no hydration sample SHALL be recorded

#### Scenario: A slow retained hydration warns

- **WHEN** a retained hydration's wall time exceeds the same slow-load
  threshold the local path uses
- **THEN** the server SHALL emit a slow-load warning identifying the session
  and the byte size
