## ADDED Requirements

### Requirement: `ProcessMetrics` carries heap ceiling and allocation breakdown

The `ProcessMetrics` payload on the session heartbeat SHALL carry three
additional optional numeric fields: `heapSizeLimit`, `external`, and
`arrayBuffers`, all in bytes.

`heapSizeLimit` makes the existing `heapUsed` and `heapTotal` readable — without
the ceiling, a heap reading cannot be judged as healthy or near-exhaustion.
`external` and `arrayBuffers` expose the allocation that sits outside the V8
heap, which is where the majority of a session's resident memory has been
observed to live.

Every field SHALL be optional. A bridge that does not report them SHALL remain
valid, and a server that does not recognise them SHALL ignore them.

#### Scenario: Bridge reports the full breakdown
- **WHEN** a bridge sends `session_heartbeat` with `metrics` including `heapSizeLimit`, `external`, and `arrayBuffers`
- **THEN** the server SHALL retain all three on the session's metrics

#### Scenario: Older bridge omits the fields
- **WHEN** a bridge sends `session_heartbeat` with `metrics` containing only the previously defined fields
- **THEN** the heartbeat SHALL be accepted
- **AND** the new fields SHALL be absent rather than zero

#### Scenario: Newer bridge against an older server
- **WHEN** a bridge sends the new fields to a server that predates them
- **THEN** the heartbeat SHALL still be accepted and the unknown fields ignored

### Requirement: `ProcessMetrics` carries garbage-collection counters

The `ProcessMetrics` payload SHALL carry three additional optional numeric
fields: `gcCount`, `gcMajorCount`, and `gcPauseMsTotal`.

The counters SHALL describe the interval since the previous heartbeat, following
the same read-and-reset discipline as the existing event-loop delay measurement,
so a consumer can attribute collection activity to a window of time rather than
to the life of the process.

The counters SHALL be accumulated as scalars. The measurement SHALL NOT retain
per-collection records between heartbeats.

Major collections SHALL be distinguished using the garbage-collection kind
reported in the performance entry's detail, compared against the platform's
major-collection constant. The entry's top-level kind property SHALL NOT be used
for this purpose; it is not populated on supported runtimes.

#### Scenario: Counters describe one heartbeat interval
- **WHEN** collections occur between two heartbeats
- **THEN** the second heartbeat SHALL report the counts and total pause for that interval only

#### Scenario: A quiet interval reports zero rather than silence
- **WHEN** no collection occurs between two heartbeats on a bridge that supports the counters
- **THEN** the heartbeat SHALL report `gcCount` of `0`

#### Scenario: Major collections are counted separately
- **WHEN** an interval contains both minor and major collections
- **THEN** `gcCount` SHALL include both
- **AND** `gcMajorCount` SHALL include only the major ones

#### Scenario: Counters are unavailable
- **WHEN** the runtime does not expose garbage-collection observation
- **THEN** the counters SHALL be omitted
- **AND** the heartbeat SHALL remain valid
