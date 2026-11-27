# Spec Delta

## MODIFIED Requirements

### Requirement: Server SHALL close every open tool call when a session ends

On `sessionManager.onEnded(sessionId)` — the terminal transition fired by BOTH the `unregister()` and the `update({status:"ended"})` seams — and BEFORE broadcasting `session_updated{status:"ended"}`, the server SHALL derive the set of open tool calls from the session's stored events — every `tool_execution_start` without `parentToolCallId` after the last `agent_start` not marked `synthetic` that has no `tool_execution_end` with the same `toolCallId`. An `agent_start` whose `data.synthetic` is `true` (the bridge's reconnect/reload re-announcement of an already-running turn, sent after its replay) SHALL NOT bound the scan; the walk SHALL continue past it to the previous unmarked `agent_start` or the stream start. Nested calls (`parentToolCallId` set) SHALL be excluded: pi may legitimately finish them as `unfinished`, and their root call's terminal event closes them in the reducer — and for each SHALL insert into the event store and broadcast a synthesized `tool_execution_end` event with `data: { toolCallId, toolName, isError: true, result: "parent session ended", healedBy: "session_ended" }`. When a plugin claims the open call's tool and its store policy names identity fields, `data.details` SHALL carry those fields recovered from the latest `tool_execution_update` for that `toolCallId` whose `data.partialResult.details` holds them as strings (for the subagents plugin and `toolName` `"Agent"`: `agentId`). Core SHALL NOT name any such field. The derivation SHALL be a pure function (`findOpenToolCalls(events)`) bounded by the store's retained window. The heal SHALL be skipped when the session record carries `movedTo` (a relocation to another instance, whose tool calls are still running on the destination). The gate SHALL be the `movedTo` field, NOT `closedReason` — `ClosedReason` has no member marking a move.

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

### Requirement: Server SHALL terminate every non-terminal subagent when a session ends

On every session end reported by the plugin status-ended notification (`plugin-synthetic-events`), which fires on the same `onEnded` seam as the tool-call heal, the subagents plugin SHALL collect every subagent id introduced by `subagent_created` or `subagent_started` with no later `subagent_completed` or `subagent_failed`, and for each SHALL append and broadcast a synthesized `subagent_failed` event with `data: { id, error: "parent session ended", healedBy: "session_ended" }`. Core SHALL NOT perform this scan. This SHALL NOT depend on `agentId` recovery from a `tool_execution_update`.

#### Scenario: subagent that never ticked is still terminated

- **GIVEN** stored events `subagent_created{id:"ag-9"}` and `subagent_started{id:"ag-9"}` with no `tool_execution_update` carrying `agentId` and no terminal subagent event
- **WHEN** the session ends
- **THEN** a `subagent_failed{id:"ag-9", error:"parent session ended"}` SHALL be inserted and broadcast
- **AND** the reducer SHALL show `ag-9` as `failed`

#### Scenario: completed subagent is left alone

- **GIVEN** `subagent_started{id:"ag-1"}` followed by `subagent_completed{id:"ag-1"}`
- **WHEN** the session ends
- **THEN** no synthesized subagent event SHALL be produced for `ag-1`
