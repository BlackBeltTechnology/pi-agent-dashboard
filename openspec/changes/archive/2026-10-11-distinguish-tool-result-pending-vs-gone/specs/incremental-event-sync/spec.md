## MODIFIED Requirements

### Requirement: Stale running-tool reconcile
The client SHALL reconcile a tool-result row that has been in `running` state for
longer than a conservative threshold (`STALE_TOOL_MS`) without a `tool_execution_end`,
via a one-shot `GET /api/sessions/:sessionId/tool-result/:toolCallId?pending=1`. The reconcile
channel is HTTP, independent of the WebSocket send buffer whose back-pressure can drop
a live terminal event, so the heal cannot be re-dropped by the same condition. The
client SHALL interpret the response status as follows:

- **200**: apply the authoritative server result.
- **202** (`{ pending: true }`): the server believes the tool is still running. Keep
  the row `running` and re-arm. A 202 is a hint, not a fact: it SHALL count toward the
  row's unrecovered-probe count exactly like a 404, so a stale hint can never strand a
  row the Superseded terminal heal could otherwise finalize.
- **410**: the server recorded that this call's stored result was dropped, which is a fact
  that the call completed. Finalize the row at once via the existing `toolCallId`-keyed
  reducer path with `isError: false`, a "result no longer available" sentinel body and a
  `healedBy: "result_evicted"` detail. No later-inference proof is required.
- **404**: unknown. Count it toward the unrecovered-probe count, keep the row running
  and re-arm. Finalization is left to the Superseded terminal heal.

The client SHALL branch on `202` and `410` BEFORE any generic success test: a `202`
is a 2xx and SHALL NOT be treated as a result. The client SHALL NOT synthesize a
completion on 202 or 404.

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

Nested calls (tool events carrying `parentToolCallId`) are not tool-result rows the reconcile scans and SHALL NOT be reconciled; their terminal state is guaranteed by the root's terminal transition instead.

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
- **WHEN** a tool is legitimately still executing, its inference is still the newest,
  and the reconcile route answers HTTP 202 `{ pending: true }` or HTTP 404
- **THEN** the client SHALL keep the running spinner and re-arm the reconcile timer
- **AND** SHALL NOT synthesize a completion
- **AND** a `{ pending: true }` body SHALL NOT be applied as a result

#### Scenario: Evicted result is finalized by supersede, not left running
- **WHEN** the server has no record of the call's result (its evicted-end record
  overflowed or was freed) and the REST route returns 404 repeatedly
- **THEN** the reconcile path SHALL NOT flip the row on a 404 (unchanged)
- **AND** finalization is delegated to the Superseded terminal heal, which fires only
  when a later assistant `message_start` proves the tool finished

#### Scenario: Server-vouched eviction is finalized immediately
- **WHEN** the reconcile route answers HTTP 410 for a `running` row
- **THEN** the client SHALL flip the row to `complete` with `healedBy: "result_evicted"`
  and a "result no longer available" body on that same tick
- **AND** SHALL NOT issue another reconcile request for that row
- **AND** SHALL increment the client heal counter and badge the card as evicted
- **AND** a genuine `tool_execution_end` arriving later SHALL overwrite the placeholder

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

#### Scenario: Nested call is never reconciled
- **WHEN** a nested call `call_1/1` has been running longer than `STALE_TOOL_MS`
- **THEN** the client SHALL NOT issue a reconcile request for it

### Requirement: Superseded terminal heal
The client SHALL finalize a `running` tool row whose authoritative result is
unrecoverable when the transcript proves the tool completed. A recorded eviction
(HTTP 410) is finalized directly by the Stale running-tool reconcile instead. A row is eligible only when
BOTH hold: (a) the base reconcile has returned an unrecovered answer (HTTP 404 or 202)
at least `SUPERSEDE_MIN_404` times for that row, AND (b) at least one assistant *inference*
strictly later than the inference that emitted the tool call has been applied for the
session, where an inference boundary is an assistant `message_start` (tracked as a
monotonic `assistantInferenceSeq`) — NOT `message_end` (which fires after its own
inference's tool), NOT the coarse per-user-cycle `turnCount`, and NOT a sibling
`tool_start` in the same inference. On
eligibility the client SHALL synthesize a `tool_execution_end` via the existing
`toolCallId`-keyed reducer path with `isError: false`, a sentinel result body, and a
`healedBy: "superseded"` detail, and SHALL increment a supersede-heal counter and render
a distinguishable badge. The synthesized state is `complete`; no new status enum value
is introduced.

#### Scenario: Unrecoverable-but-superseded card is finalized
- **WHEN** a tool row has been `running` past `STALE_TOOL_MS`, the reconcile route has
  returned 404 at least `SUPERSEDE_MIN_404` times, and a later assistant `message_start`
  exists after the tool call's inference
- **THEN** the client SHALL flip the row to `complete` with `healedBy: "superseded"` and
  a "result not captured (recovered)" body
- **AND** SHALL increment the supersede-heal counter and badge the card

#### Scenario: Parallel in-flight tool in the current inference is not falsely completed
- **WHEN** a tool row is `running`, its inference is still the newest (no later assistant
  `message_start` exists yet), even if a sibling `tool_start` in the same inference has
  appeared, or the emitting inference's own `message_end` has fired
- **THEN** the client SHALL NOT apply the supersede heal
- **AND** SHALL keep the running spinner

#### Scenario: Recovery still preferred — real result wins over placeholder
- **WHEN** a row was previously finalized by the supersede heal (`healedBy: "superseded"`)
  or the eviction heal (`healedBy: "result_evicted"`) and a genuine
  `tool_execution_end` later arrives (late reconcile 200, in-app full replay, or bridge
  reconnect re-sync)
- **THEN** the reducer SHALL overwrite the placeholder with the authoritative result
- **AND** a synthesized placeholder SHALL NOT overwrite a real completion nor another
  synthesized placeholder

#### Scenario: Fallback never fires before recovery is exhausted
- **WHEN** the base reconcile returns HTTP 200 before `SUPERSEDE_MIN_404` 404s accrue
- **THEN** the row is healed by the base reconcile with its real body
- **AND** the supersede heal SHALL NOT fire for that row

#### Scenario: Pending answers alone never finalize a running tool
- **WHEN** a tool's reconcile has answered HTTP 202 any number of times and no assistant
  `message_start` later than the tool's inference exists
- **THEN** the supersede heal SHALL NOT fire for it
- **AND** the row SHALL stay `running`

#### Scenario: A stale pending hint cannot strand a finished tool
- **WHEN** a tool's reconcile has answered HTTP 202 at least `SUPERSEDE_MIN_404` times
  and an assistant `message_start` later than the tool's inference exists
- **THEN** the supersede heal SHALL finalize the row with `healedBy: "superseded"`
