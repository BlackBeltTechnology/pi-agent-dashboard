## MODIFIED Requirements

### Requirement: Server SHALL close every open tool call when a session ends

On `sessionManager.onEnded(sessionId)` — the terminal transition fired by BOTH the `unregister()` and the `update({status:"ended"})` seams — and BEFORE broadcasting `session_updated{status:"ended"}`, the server SHALL derive the set of open tool calls from the session's stored events — every `tool_execution_start` without `parentToolCallId` after the last `agent_start` not marked `synthetic` that has no `tool_execution_end` with the same `toolCallId`. An `agent_start` whose `data.synthetic` is `true` (the bridge's reconnect/reload re-announcement of an already-running turn, sent after its replay) SHALL NOT bound the scan; the walk SHALL continue past it to the previous unmarked `agent_start` or the stream start. Nested calls (`parentToolCallId` set) SHALL be excluded: pi may legitimately finish them as `unfinished`, and their root call's terminal event closes them in the reducer — and for each SHALL insert into the event store and broadcast a synthesized `tool_execution_end` event with `data: { toolCallId, toolName, isError: true, result: "parent session ended", healedBy: "session_ended" }`. When the open call's `toolName` is `"Agent"`, `data.details.agentId` SHALL carry the agent id recovered from the latest `tool_execution_update` for that `toolCallId` whose `data.partialResult.details.agentId` is a string. The derivation SHALL be a pure function (`findOpenToolCalls(events)`) bounded by the store's retained window. The heal SHALL be skipped when the session record carries `movedTo` (a relocation to another instance, whose tool calls are still running on the destination). The gate SHALL be the `movedTo` field, NOT `closedReason` — `ClosedReason` has no member marking a move.

#### Scenario: two open tool calls, one Agent, on watchdog death

- **GIVEN** stored events `agent_start`, `tool_execution_start{id:A, toolName:"Agent"}`, `tool_execution_update{id:A, data.partialResult.details.agentId:"ag-1"}`, `tool_execution_start{id:B, toolName:"bash"}` and no ends
- **WHEN** the session ends (grace period expired)
- **THEN** exactly two `tool_execution_end` events SHALL be inserted, for `A` and `B`, each with `isError:true` and `healedBy:"session_ended"`
- **AND** the event for `A` SHALL carry `toolName:"Agent"` and `details.agentId === "ag-1"`
- **AND** both SHALL be broadcast to subscribed browsers before `session_updated{status:"ended"}`
- **AND** a subsequent replay of the session SHALL include both synthesized events after the originals

#### Scenario: nothing open is a no-op

- **GIVEN** every `tool_execution_start` since the last `agent_start` has a matching `tool_execution_end`
- **WHEN** the session ends
- **THEN** no event SHALL be inserted or broadcast beyond the existing `session_updated`

#### Scenario: a second end transition inserts nothing

- **GIVEN** the heal already ran for a session
- **WHEN** `onEnded` fires again for it (for example a later `closedReason` change)
- **THEN** no further event SHALL be inserted

#### Scenario: earlier turns are not reopened

- **GIVEN** a `tool_execution_start{id:C}` in a turn before the last `agent_start`, with no end
- **WHEN** the session ends
- **THEN** no synthesized end SHALL be produced for `C`

#### Scenario: every ending path heals

- **WHEN** a session ends via TUI quit, heartbeat expiry, run termination, reconnect-grace expiry, spawn failure, `process_gone` normalization, or manual force-kill
- **THEN** the same synthesis SHALL run (single hook on `onEnded`)

#### Scenario: a relocated session is not falsely errored

- **GIVEN** a session with one open tool call
- **WHEN** it ends because it was moved to another instance (`movedTo`)
- **THEN** no synthesized end SHALL be produced

#### Scenario: an ending that never unregisters still heals

- **GIVEN** a session with one open tool call
- **WHEN** it is ended via `sessionManager.update(id, { status: "ended" })` without `unregister()`
- **THEN** the synthesized `tool_execution_end` SHALL still be inserted and broadcast

#### Scenario: Nested start without an end is not healed
- **WHEN** a session ends whose stored events contain `tool_execution_start` for `call_1/1` (with `parentToolCallId: "call_1"`) and no end for it, while `call_1` has ended
- **THEN** no synthesized `tool_execution_end` SHALL be produced for `call_1/1`

#### Scenario: Root call still healed
- **WHEN** a session ends while `call_1` and its nested call `call_1/1` are both open
- **THEN** a synthesized end SHALL be produced for `call_1` only

#### Scenario: a call replayed open across a reconnect is healed on real death

- **GIVEN** stored events `agent_start`, `tool_execution_start{id:A, toolName:"Agent"}` (replayed open by a live bridge), then `agent_start{synthetic:true}`, and no end for `A`
- **WHEN** the session ends
- **THEN** a synthesized `tool_execution_end` for `A` with `healedBy:"session_ended"` SHALL be inserted

#### Scenario: an unmarked agent_start still bounds the scan

- **GIVEN** stored events `tool_execution_start{id:C}` then `agent_start` (no `synthetic` field) and no end for `C`
- **WHEN** the session ends
- **THEN** no synthesized end SHALL be produced for `C`

### Requirement: Transcript replay SHALL mark an orphaned tool call as ended in error

`replayEntriesAsEvents` closes tool calls left open by a killed process. That orphan-close event SHALL carry `result: "parent session ended"`, `isError: true` and `healedBy: "session_ended"`, so every COLD transcript-sourced replay (disk hydration, archive, remote retained transcript) agrees with the live server heal. Nothing SHALL be written to the transcript file.

A replay produced by a LIVE bridge (register / reconnect / reload replay of the running pi process) SHALL NOT close a call that process may still be executing: when the agent is not idle, every `toolCall` of the LAST assistant message in the replayed branch that has no `toolResult` SHALL be left open (no synthesized `tool_execution_end`). Open calls in EARLIER assistant messages are dead and SHALL still be closed as above. When the agent is idle, the live bridge replay SHALL close every orphan as above (nothing can still be running).

#### Scenario: a killed turn replays as an error card

- **GIVEN** a transcript whose last turn has a `toolCall` with no `toolResult`
- **WHEN** it is replayed cold (disk, archive, retained remote)
- **THEN** the emitted `tool_execution_end` SHALL carry `isError: true`, `result: "parent session ended"` and `healedBy: "session_ended"`
- **AND** the transcript file SHALL be unmodified

#### Scenario: a completed turn is unaffected

- **GIVEN** a transcript where every `toolCall` has a `toolResult`
- **WHEN** it is replayed
- **THEN** no orphan-close event SHALL be emitted

#### Scenario: a live bridge replay mid-turn leaves the in-flight calls open

- **GIVEN** a live pi session whose agent is running and whose last assistant message has `toolCall` `A` (`Agent`) and `B` (`bash`) with no `toolResult`
- **WHEN** the bridge replays the session (dashboard restart, WS reconnect, or `/reload`)
- **THEN** the replay SHALL contain `tool_execution_start` for `A` and `B`
- **AND** SHALL contain no `tool_execution_end` for `A` or `B`
- **AND** the dashboard SHALL show both cards as running, not failed

#### Scenario: a live bridge replay still closes dead orphans from earlier messages

- **GIVEN** a live, running pi session whose branch contains an earlier assistant message with `toolCall` `C` that never got a `toolResult`, followed by later messages
- **WHEN** the bridge replays the session
- **THEN** `C` SHALL be closed with `isError: true`, `result: "parent session ended"`, `healedBy: "session_ended"`

#### Scenario: a live bridge replay of an idle agent closes every orphan

- **GIVEN** a live pi session whose agent is idle and whose last assistant message has a `toolCall` with no `toolResult`
- **WHEN** the bridge replays the session
- **THEN** that call SHALL be closed as an orphan exactly as in a cold replay

#### Scenario: subagent cards are live-only

- **WHEN** any transcript is replayed
- **THEN** no subagent lifecycle event SHALL be expected from it (they are never persisted), and the subagent heal SHALL apply to the live path only

## ADDED Requirements

### Requirement: A live tick SHALL reopen a `session_ended`-healed tool card

A `session_ended` heal asserts the producing process is dead. A later live `tool_execution_update` for the same `toolCallId` proves it is not. When the client reduces such an update for a top-level row whose `toolDetails.healedBy` is `"session_ended"`, it SHALL restore the call to running: the row's `toolStatus` and its `toolCalls` entry SHALL become `running`, the heal-only markers (`healedBy`, `resultMissing`) and the heal's `error` SHALL be cleared, the heal-derived `duration` SHALL be cleared, and the row SHALL take the update's details and partial result. For `toolName: "Agent"`, a linked subagent whose `failed` status came from a `session_ended` heal SHALL return to `running`; the client SHALL record which heal produced a subagent's terminal state so that a subagent that failed for real is never reopened. Rows healed by any other marker (`superseded`, `turn_settled`, `subagent_stopped`, `result_evicted`) SHALL keep today's behaviour, and a real (non-healed) terminal row SHALL never be reopened.

#### Scenario: fabricated end followed by a live Agent tick

- **GIVEN** tool call `A` (`Agent`, `agentId: "ag-1"`) was finalized by `tool_execution_end{isError:true, result:"parent session ended", healedBy:"session_ended"}`
- **WHEN** `tool_execution_update{toolCallId:A, partialResult:{details:{agentId:"ag-1", status:"running"}}}` reduces
- **THEN** the row `toolStatus` SHALL be `running` and `toolCalls.get(A).status` SHALL be `running`
- **AND** `toolDetails.healedBy` SHALL be absent and `duration` SHALL be undefined
- **AND** subagent `ag-1` status SHALL be `running`
- **AND** the card SHALL NOT be counted as failed nor badged "result not received"

#### Scenario: the real end after a reopen finalizes normally

- **GIVEN** the reopened row from the previous scenario
- **WHEN** the real `tool_execution_end{toolCallId:A, isError:false, result:"done"}` reduces
- **THEN** the row SHALL be `complete` with result `"done"` and the subagent SHALL be `completed`

#### Scenario: a real terminal row is not reopened

- **GIVEN** tool call `A` finalized by a real `tool_execution_end` (no `healedBy`)
- **WHEN** a late `tool_execution_update` for `A` reduces
- **THEN** `toolStatus` SHALL remain terminal

#### Scenario: a really-failed subagent is not reopened

- **GIVEN** subagent `ag-1` failed via a real `subagent_failed` (no `healedBy`) and its Agent row was healed `session_ended`
- **WHEN** a live `tool_execution_update` for that row reduces
- **THEN** `ag-1` SHALL remain `failed`

#### Scenario: other heals keep their behaviour

- **GIVEN** a row healed with `healedBy: "turn_settled"` or a row whose subagent is `completed`
- **WHEN** a late `tool_execution_update` reduces
- **THEN** the terminal status, result and heal markers SHALL be preserved as before
