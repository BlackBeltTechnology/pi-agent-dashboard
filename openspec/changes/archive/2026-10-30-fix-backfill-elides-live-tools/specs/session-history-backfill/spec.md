## ADDED Requirements

### Requirement: A backfill response reports which served tool calls are still open

A successful `history_backfill_result` SHALL carry the identifiers of the top-level tool calls whose `tool_execution_start` it serves and that are still open, evaluated when the response is sent. A served call SHALL count as open only when the store holds, after its start, none of: its `tool_execution_end`, a non-synthetic `agent_start`, an `agent_end`, or an assistant `message_start`. The field SHALL be optional and additive; an absent field SHALL mean no open calls.

#### Scenario: A still-running served start is reported open

- **WHEN** a backfill response serves a top-level `tool_execution_start` for `call_1`
- **AND** the store holds no `tool_execution_end` for `call_1`, no later non-synthetic `agent_start`, no later `agent_end` and no later assistant `message_start`
- **THEN** the response SHALL list `call_1` as open

#### Scenario: A served start whose end is stored is not reported open

- **WHEN** a backfill response serves a top-level `tool_execution_start` for `call_1`
- **AND** the store holds a `tool_execution_end` for `call_1` (real or synthesized heal)
- **THEN** the response SHALL NOT list `call_1`

#### Scenario: A start from an earlier turn is not reported open

- **WHEN** a served `tool_execution_start` for `call_1` has no stored end
- **AND** a non-synthetic `agent_start` is stored after it
- **THEN** the response SHALL NOT list `call_1`

#### Scenario: A synthetic re-announcement does not end the turn

- **WHEN** a served `tool_execution_start` for `call_1` has no stored end
- **AND** the only `agent_start` stored after it is marked synthetic
- **AND** nothing else listed in this requirement is stored after it
- **THEN** the response SHALL list `call_1` as open

#### Scenario: A start in an ended turn is not reported open

- **WHEN** a served `tool_execution_start` for `call_1` has no stored end
- **AND** an `agent_end` is stored after it
- **THEN** the response SHALL NOT list `call_1`

#### Scenario: A start superseded by a later inference is not reported open

- **WHEN** a served `tool_execution_start` for `call_1` has no stored end
- **AND** an assistant `message_start` is stored after it
- **THEN** the response SHALL NOT list `call_1`

#### Scenario: Only starts actually served are reported

- **WHEN** a call is open but its `tool_execution_start` is not among the events the response delivers
- **THEN** the response SHALL NOT list it

#### Scenario: Nested starts are never reported

- **WHEN** a served `tool_execution_start` carries `parentToolCallId` and has no stored end
- **THEN** the response SHALL NOT list it

#### Scenario: An end stored while the request is in flight excludes the call

- **WHEN** a `tool_execution_end` for a served call is stored after the slice is read but before the response is sent
- **THEN** the response SHALL NOT list that call

#### Scenario: An end stored after the response follows it on the wire

- **WHEN** a `tool_execution_end` for a call listed open is stored after the response is sent
- **THEN** the client SHALL receive that end after the response

#### Scenario: A relocated session reports no open calls

- **WHEN** a backfill response is served for a session recorded as moved to another host
- **THEN** the response SHALL NOT carry open-call identifiers

#### Scenario: An older client ignores the field

- **WHEN** a client that does not read open-call identifiers receives a response carrying them
- **THEN** it SHALL behave exactly as with a response that omits them

#### Scenario: A refusal carries no open calls

- **WHEN** a backfill request is refused for any reason
- **THEN** the response SHALL NOT carry open-call identifiers

## MODIFIED Requirements

### Requirement: The client splices backfilled events into the gap

The client SHALL insert backfilled events at their seq-ordered position within the elided region, adjacent to the segment the served range abuts, and SHALL NOT treat them as a replay or a reset. The splice SHALL NOT presume a head segment exists.

#### Scenario: Splice does not reset transcript state

- **WHEN** a backfill response is applied
- **THEN** the existing rows SHALL remain present
- **AND** the transcript SHALL NOT be rebuilt from scratch

#### Scenario: Splice preserves scroll position

- **WHEN** backfilled events are spliced into the transcript
- **THEN** the content the user is currently viewing SHALL remain at the same visual position

#### Scenario: Splice into a head-free gap lands below the loading head

- **WHEN** the window has no head segment and a backfill response is applied
- **THEN** the spliced rows SHALL be placed directly below the loading head
- **AND** the loading head SHALL remain the transcript's first row

#### Scenario: Tail-anchored events land adjacent to the tail

- **WHEN** a backfill response carrying the events immediately below the tail edge is applied
- **THEN** those events SHALL be inserted between the gap divider and the first tail row

#### Scenario: Measurement of spliced rows does not move the viewport

- **WHEN** the virtualizer measures the spliced rows and their measured heights differ from the estimates
- **THEN** the divider SHALL remain at the same visual position

#### Scenario: Splice does not re-pin the view to the bottom

- **WHEN** a backfill response is applied while the user is scrolled up, including when the divider sits within the near-bottom threshold
- **THEN** the transcript SHALL NOT scroll to the bottom

#### Scenario: A two-sided splice does not trigger the selection-anchor correction

- **WHEN** a backfill response is applied in `head-tail` while a text selection is held in the transcript
- **THEN** no selection-anchor scroll correction SHALL be applied for that commit

#### Scenario: A head-free splice keeps the selection anchored

- **WHEN** a backfill response is applied in `tail-only` while a text selection is held in the transcript
- **THEN** the selection-anchor correction SHALL remain active for that commit
- **AND** the selected row SHALL keep its viewport position while the head fills
- **AND** the retained selection's row-index span SHALL be remapped across the splice so the selected row stays mounted

#### Scenario: Splice leaves live-event bookkeeping untouched

- **WHEN** a backfill response is applied
- **THEN** the session's live-event high-water mark SHALL NOT change
- **AND** the backfilled events SHALL NOT be published to the plugin-runtime event store
- **AND** the backfilled events SHALL NOT be written to the durable replay cache
- **AND** the session's tool-call tracking SHALL change only by gaining a running entry for each spliced call the response reports open and the session does not already track

#### Scenario: A reported-open spliced call becomes tracked as running

- **WHEN** a backfill response reports `call_1` open and the session does not yet track `call_1`
- **THEN** after the splice the session SHALL track `call_1` as running with the start time of its row
- **AND** it SHALL be eligible for the stale running-tool reconcile

#### Scenario: A response with no place to splice changes nothing

- **WHEN** a backfill response arrives for a session whose gap row is not present in the transcript
- **THEN** the client SHALL NOT advance its gap bookkeeping
- **AND** the transcript SHALL be left unchanged
