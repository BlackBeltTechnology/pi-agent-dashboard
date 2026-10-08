# Test Plan — render-nested-tool-calls

Stage: design   Generated: 2026-10-02 (regenerated after doubt-review cycles 1–3)

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | nested attach live | state-transition | L1 | automated | `call_1` running | `tool_execution_start {toolCallId:"call_1/1", parentToolCallId:"call_1"}` | no new top-level ToolCallState; `call_1.nested` has `call_1/1` running |
| E2 | grandchild attaches to root | EP | L1 | automated | `call_1` running with nested `call_1/1` | start `call_1/1/1` parent `call_1/1` | listed under `call_1` with `parentId` `call_1/1` |
| E3 | nested end error | state-transition | L1 | automated | nested `call_1/1` running | end `isError:true` | nested status `error`; `call_1` status unchanged |
| E4 | root end closes nested; late end overwrites | state-transition | L1 | automated | `call_1/1` running | `call_1` ends, then real end for `call_1/1` `isError:false` | `call_1/1` `unfinished`, then `complete` |
| E5 | nested update | state-transition | L1 | automated | `call_1/1` running | `tool_execution_update` for `call_1/1` | nested entry shows latest partial; no top-level row |
| E6 | transcript replay rebuild | EP | L1 | automated | transcript toolResult for `call_1` with `nestedCalls` records `call_1/1` ok, `call_1/1/1` error, `call_1/2` unfinished with `argumentsBytes:9000`, `complete:false` | `state-replay` synthesis then reduce | synthesized end carries `nestedCalls`; three entries with `complete`/`error`/`unfinished`; `call_1/1/1` `parentId` `call_1/1`; "arguments omitted (9000 bytes)"; incomplete-record notice |
| E7 | live record merge | decision-table | L1 | automated | live `call_1/1` (with result), `call_1/2`, `call_1/3` running; `call_1` ended | live toolResult `message_end` with record for `call_1/1` ok, `call_1/2` error, `call_1/4` ok, `complete:false` | `call_1/1` ok with live result kept; `call_1/2` error; `call_1/4` created; `call_1/3` kept as `unfinished`; none `running` |
| E8 | classification, orphan, fallback | decision-table | L1 | automated | (a) nested start, unknown root; (b) non-conforming id `x9` with `parentToolCallId` = known nested `call_1/1`; (c) top-level start `call_7/a` without `parentToolCallId` | start event | (a) dropped, no row, no throw; (b) attached under root `call_1`; (c) top-level ToolCallState `call_7/a` created |
| E9 | window-edge nested start | EP | L1 | automated | backfill segment with nested start and no end | segment reduce | no top-level row created or elided |
| E10 | window-edge orphan end with record | EP | L1 | automated | segment begins with `tool_execution_end` for `call_1` carrying `nestedCalls`; start elided | segment reduce | no throw; no tool row and no nested entries for `call_1` |
| E11 | late nested start under terminal / elided root | state-transition (illegal edge) | L1 | automated | (a) `call_1` complete; (b) `call_1` elided | nested start `call_1/2` | entry created `unfinished`, never `running` |
| E12 | nested start does not flush | state-transition | L1 | automated | `streamingText:"I'll run:"`, `streamingTextFlushed:false` | nested `tool_execution_start` | no assistant row pushed; `streamingText` and `streamingTextFlushed` unchanged |
| E13 | client currentTool ignores nested | EP | L1 | automated | `SessionState.currentTool:"codemode"` | nested start `bash`, then nested end | `currentTool` stays `codemode` throughout |
| E14 | long nested result truncated | BVA | L1 | automated | nested end for `call_1/1` with result one line over the tool-result truncation limit | reduce | last lines kept with omission marker; full-output affordance flag set |
| E15 | server currentTool ignores nested | EP | L1 | automated | `currentTool:"codemode"`; cases `hasPendingPrompt` false and true | nested `tool_execution_start` / `tool_execution_end` with `parentToolCallId` | `extractSessionUpdates` returns `null` in all cases; top-level end with pending prompt still yields `ask_user` |
| E16 | heal skips nested | EP | L1 | automated | stored events: (a) `call_1` ended, `call_1/1` start without end; (b) both open | `findOpenToolCalls` | (a) empty; (b) only `call_1` |
| E17 | reconcile skips nested | EP | L1 | automated | nested `call_1/1` running > `STALE_TOOL_MS` | reconcile tick | no request issued |
| E18 | nested bash in-flight | EP | L1 | automated | root `codemode` with nested `bash` running (`startedAt`, `args.command`) | `selectInflightBashTools` | includes it with its command and `startedAt` |
| E19 | encoded tool-result fetch (server) | EP | L1 | automated | stored end for `call_1/1` | `GET /api/sessions/:id/tool-result/call_1%2F1` | 200 with the stored result; raw `call_1/1` path 404 |
| E20 | encoded tool-result fetch (client) | EP | L1 | automated | nested `call_1/1` with truncated result | `useToolFullResult` fetch | request URL ends `/tool-result/call_1%2F1` |
| E21 | forwarder carries parentToolCallId | EP | L1 | automated | pi `tool_execution_start` with `parentToolCallId:"call_1"` | `mapEventToProtocol` | `event_forward.event.data.parentToolCallId === "call_1"` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | record survives generic truncation | fault-injection (oversize) | L1 | automated | toolResult `message_end` whose `message.nestedCalls.calls` has 40 records, one with a 6-level-deep `arguments` object | event-store insert | stored `calls` is an array of 40 records with `id`,`name`,`status`; the deep `arguments` sub-tree is summarized, not raw |
| X2 | not a ceiling exemption | fault-injection (oversize) | L1 | automated | event with `nestedCalls` pushing data past `MAX_EVENT_DATA_SIZE` (test ceiling 20000) | event-store insert | no throw; stored data within the ceiling via the existing bound |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | nested list rendered | state-transition | L1 | automated | ToolCallState with 3 nested entries (one grandchild, one `unfinished`) and `nestedComplete:false` | render tool card | collapsed count "3"; expanded shows grandchild indented, `unfinished` with neither spinner nor error styling, incomplete-record notice |
| F2 | codemode session end-to-end | convergence | — | manual-only | real session `+codemode`, script with bash, another tool, a failing tool, >20 calls | run, reload, end session | [judgment: nested list readable live and after reload; no stuck cards or raw rows] |

---

## Coverage summary

- Requirements covered: 12/12 (event-reducer ×3, event-status-extraction, token-stats-pipeline, prompt-derived-tool-state, session-end-orphan-heal, on-demand-session-replay, incremental-event-sync, in-memory-event-buffer, forwarder carry, route encoding)
- Scenarios by class: edge 21 · perf 0 · frontend 2 · error 2
- Scenarios by level: L1 24 · L2 0 · L3 0
- Scenarios by disposition: automated 24 · manual-only 1

## New infra needed

- none
