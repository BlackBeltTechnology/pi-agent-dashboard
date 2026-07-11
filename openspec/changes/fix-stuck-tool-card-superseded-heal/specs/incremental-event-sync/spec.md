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

## ADDED Requirements

### Requirement: Superseded terminal heal
The client SHALL finalize a `running` tool row whose authoritative result is
unrecoverable when the transcript proves the tool completed. A row is eligible only when
BOTH hold: (a) the base reconcile has returned HTTP 404 at least `SUPERSEDE_MIN_404`
times for that row (the store has no result), AND (b) at least one assistant *inference*
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
  and a genuine `tool_execution_end` later arrives (late reconcile 200, in-app full
  replay, or bridge reconnect re-sync)
- **THEN** the reducer SHALL overwrite the placeholder with the authoritative result
- **AND** a superseded placeholder SHALL NOT overwrite a real completion nor another
  superseded placeholder

#### Scenario: Fallback never fires before recovery is exhausted
- **WHEN** the base reconcile returns HTTP 200 before `SUPERSEDE_MIN_404` 404s accrue
- **THEN** the row is healed by the base reconcile with its real body
- **AND** the supersede heal SHALL NOT fire for that row
