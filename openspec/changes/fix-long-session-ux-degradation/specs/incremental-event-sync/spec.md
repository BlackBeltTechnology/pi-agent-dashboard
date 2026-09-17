## MODIFIED Requirements

### Requirement: Stale running-tool reconcile
The client SHALL reconcile a tool-result row that has been in `running` state for
longer than a conservative threshold (`STALE_TOOL_MS`) without a `tool_execution_end`,
via a one-shot `GET /api/sessions/:sessionId/tool-result/:toolCallId`. The reconcile
channel is HTTP, independent of the WebSocket send buffer whose back-pressure can drop
a live terminal event, so the heal cannot be re-dropped by the same condition. The
client SHALL apply only the authoritative server result on HTTP 200 and SHALL NOT
synthesize a completion from the reconcile path itself. When the authoritative result
is unrecoverable (repeated HTTP 404) the row is finalized only by the separate
Superseded terminal heal below, and only under its stricter proof-of-completion
condition.

The per-row bookkeeping the reconcile keeps across ticks (last attempt time and
consecutive not-found count, keyed per session and tool call) SHALL NOT grow
without bound over the lifetime of a session. On each reconcile tick, before
scanning for stale rows, the client SHALL discard bookkeeping for every key that
does not correspond to a tool-result row still in `running` state. A terminal
(complete/error/elided) row's bookkeeping is discarded even though the row itself
remains in session state — client state never evicts tool rows, so retaining
bookkeeping for present-but-terminal rows would leave the growth unbounded in
exactly the long-session case this requirement exists to bound.

Discarding is lossless with respect to reconcile behavior: both consuming scans
are gated on `running` status, so a discarded key is by construction one no scan
can reach; a row that is still running keeps its backoff and not-found count.
Consequently a long-lived session's reconcile bookkeeping SHALL be proportional
to the number of currently-running tool rows, not to the total number of tool
calls ever executed. A late in-flight reconcile response MAY re-insert a key for
a row that has since left `running`; such a key SHALL be discarded by the next
tick, so the bound holds.

#### Scenario: Bookkeeping for completed rows is discarded
- **GIVEN** a long-lived session in which many tool calls have run and reached a terminal state
- **AND** the tool-result rows for those calls are still present in session state
- **WHEN** a reconcile tick runs
- **THEN** the reconcile bookkeeping SHALL retain entries only for rows still in `running` state
- **AND** the retained entry count SHALL NOT grow with the number of tool calls ever executed

#### Scenario: A still-running row keeps its backoff across a discard
- **GIVEN** a running tool row that has accumulated a consecutive not-found count
- **WHEN** a reconcile tick discards bookkeeping for other, terminal rows
- **THEN** that running row's last-attempt time and not-found count SHALL be unchanged
- **AND** its backoff and supersede-exhaustion behavior SHALL be unaffected

#### Scenario: Dropped terminal event reconciles from REST
- **WHEN** a tool card's `tool_execution_end` was dropped on the server→browser hop
  (the event is still recorded in the server store), and the row has been `running`
  for more than `STALE_TOOL_MS`
- **THEN** the client SHALL fetch the tool result by `toolCallId`
- **AND** on a completed result (HTTP 200) SHALL flip the row to its terminal
  (complete/error) state without a manual page refresh

#### Scenario: Genuinely slow tool is not falsely completed
- **WHEN** a tool is legitimately still executing, its turn is still the newest turn,
  and the server has no `tool_execution_end` for it (HTTP 404 / in-flight)
- **THEN** the client SHALL keep the running spinner and re-arm the reconcile timer
- **AND** SHALL NOT synthesize a completion

#### Scenario: Evicted result is finalized by supersede, not left running
- **WHEN** the server store has evicted the `tool_execution_end` under memory pressure
  and the REST route returns 404 repeatedly
- **THEN** the reconcile path SHALL NOT flip the row on a 404 (unchanged)
- **AND** finalization is delegated to the Superseded terminal heal, which fires only
  when a later assistant `message_start` proves the tool finished

#### Scenario: Bookkeeping for vanished rows is discarded
- **GIVEN** a session has executed many tool calls whose rows are no longer present
  in client state
- **WHEN** the next reconcile tick runs
- **THEN** the retained per-row bookkeeping SHALL contain entries only for tool
  rows that are still present
- **AND** the retained entry count SHALL NOT grow with the session's cumulative
  tool-call count

#### Scenario: Retained backoff state survives for live rows
- **GIVEN** a still-running tool row has already been attempted and returned 404
- **WHEN** the next reconcile tick prunes vanished keys
- **THEN** that row's last-attempt time and not-found count SHALL be preserved
- **AND** its backoff and 404 handling SHALL behave exactly as before the prune
