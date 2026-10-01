# Test Plan — render-nested-tool-calls

Stage: design   Generated: 2026-09-30

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | nested attach live | state-transition | L1 | automated | `call_1` running | `tool_execution_start {toolCallId:"call_1/1", parentToolCallId:"call_1"}` | no new top-level ToolCallState; `call_1.nested` has `call_1/1` running |
| E2 | grandchild attaches to root | EP | L1 | automated | `call_1` running with nested `call_1/1` | start `call_1/1/1` parent `call_1/1` | listed under `call_1` beneath `call_1/1` |
| E3 | nested end error | state-transition | L1 | automated | nested `call_1/1` running | end `isError:true` | nested status error; `call_1` status unchanged |
| E4 | root end closes nested; late end overwrites | state-transition | L1 | automated | `call_1/1` running | `call_1` ends, then real end for `call_1/1` `isError:false` | `call_1/1` unfinished, then complete |
| E5 | nested update | state-transition | L1 | automated | `call_1/1` running | `tool_execution_update` for `call_1/1` | nested entry shows latest partial; no top-level row |
| E6 | replay rebuild | EP | L1 | automated | toolResult for `call_1` with `nestedCalls` records `ok`,`error`,`unfinished` (one with `argumentsBytes`), `complete:false` | transcript replay | three nested entries with mapped statuses, "arguments omitted (N bytes)", not-recorded notice |
| E7 | live/record merge | decision-table | L1 | automated | live `call_1/1`,`call_1/2`; record has both, `complete:false`; plus live `call_1/3` not in record | toolResult arrives | recorded status/duration applied, live results kept, `call_1/3` kept |
| E8 | orphan / fallback | decision-table | L1 | automated | unknown root; non-conforming id whose `parentToolCallId` is a known nested id | nested start | orphan dropped without throw; fallback attaches to that entry's root |
| E9 | window-edge nested start | EP | L1 | automated | backfill segment with nested start and no end | segment reduce | no top-level row created or elided |
| E10 | currentTool ignores nested | EP | L1 | automated | `currentTool:"codemode"` | nested `tool_execution_end` with `parentToolCallId` | `currentTool` stays `codemode` (both extraction paths) |
| E11 | heal skips nested | EP | L1 | automated | stored events: `call_1` ended, `call_1/1` start without end; and a case with both open | session end heal | no synthesized end for `call_1/1`; only `call_1` healed when both open |
| E12 | reconcile skips nested | EP | L1 | automated | nested `call_1/1` running > `STALE_TOOL_MS` | reconcile tick | no request issued |
| E13 | nested bash in-flight | EP | L1 | automated | nested `bash` running | `selectInflightBashTools` | includes it |
| E14 | encoded tool-result fetch | EP | L1 | automated | stored end for `call_1/1` | `GET /api/sessions/:id/tool-result/call_1%2F1` | 200 with the full result |
| E15 | nested tool_call/tool_result not forwarded | EP | L1 | automated | pi emits `tool_result` with `parentToolCallId` | bridge handler | no `event_forward`; fan-out admission still invoked for a nested `Agent` `tool_call` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | record survives truncation | fault-injection (oversize) | L1 | automated | toolResult event with 40 nested records | event-store insert | stored `calls` is an array of records with `id`,`name`,`status` |
| X2 | oversized record degrades | fault-injection (oversize) | L1 | automated | record pushing event past the per-event ceiling | event-store insert | `arguments` dropped, oldest records dropped, `complete:false`, parent result present |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | nested list rendered | state-transition | L1 | automated | ToolCallState with 3 nested entries (one grandchild) | render tool card | collapsed count "3"; expanded shows indented grandchild |
| F2 | codemode session end-to-end | convergence | — | manual-only | real session `+codemode`, script with bash, another tool, a failing tool, >20 calls | run, reload, end session | [judgment: nested list readable live and after reload; no stuck cards or raw rows] |

---

## Coverage summary

- Requirements covered: 11/11
- Scenarios by class: edge 15 · perf 0 · frontend 2 · error 2
- Scenarios by level: L1 18 · L2 0 · L3 0
- Scenarios by disposition: automated 18 · manual-only 1

## New infra needed

- none
