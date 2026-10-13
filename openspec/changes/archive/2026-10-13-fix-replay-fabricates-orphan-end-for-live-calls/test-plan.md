# Test Plan — fix-replay-fabricates-orphan-end-for-live-calls

Stage: design   Generated: 2026-10-13

No clarifications outstanding (hard gate passed: every Triple fills from the delta specs + design D1–D8).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | orphan-heal: transcript replay (live tail) | decision-table (liveTailOpen × message position) | L1 | automated | entries: user, assistant{toolCall A Agent, B bash}, no toolResults | `replayEntriesAsEvents(id, entries, undefined, {liveTailOpen:true})` | starts for A and B emitted; zero `tool_execution_end` events |
| E2 | orphan-heal: dead earlier orphans still close | decision-table | L1 | automated | entries: assistant{toolCall C}, user, assistant{toolCall D}; no toolResults | same call with `liveTailOpen:true` | exactly one end, for C, with `isError:true`, `result:"parent session ended"`, `healedBy:"session_ended"`; none for D |
| E3 | orphan-heal: partial last message | BVA (0/1/all results in tail) | L1 | automated | last assistant{toolCall E, F}; toolResult for E only | `liveTailOpen:true` | E has its real end (no `healedBy`); F has no end |
| E4 | orphan-heal: cold replay unchanged | equivalence (option absent/false) | L1 | automated | E1 fixture | call with no opts AND with `{liveTailOpen:false}` | both outputs deep-equal each other and the pre-change output: A and B closed with `healedBy:"session_ended"` |
| E5 | bridge liveness `isLive` | decision-table (flag × isIdle: true/false/missing/throws) | L1 | automated | 8 combos of `isAgentStreaming` ∈ {true,false} × `isIdle` ∈ {()=>true, ()=>false, absent, throws} | `isLive(ctx, flag)` | true iff `flag===true` or `isIdle()===false`; never throws |
| E6 | bridge replay wiring | state-transition (reconnect / session_start / session change) | L1 | automated | mock bc with `cachedCtx.getBranch()` = E1 entries, connection spy | `replaySessionEntries(bc,{liveTailOpen:true})`; `replaySessionEntries(bc)`; `handleSessionChange(...)` | sent frames: no end for A/B in the first; ends for A/B in the second and in session change |
| E7 | orphan-heal server scan past synthetic start | state-transition | L1 | automated | stored: `agent_start`, start A (Agent) + update agentId ag-1, `agent_start{synthetic:true}`, no end | `findOpenToolCalls(events)` | returns `[{toolCallId:"A", toolName:"Agent", agentId:"ag-1"}]` |
| E8 | orphan-heal: unmarked start still bounds | state-transition (illegal edge) | L1 | automated | stored: start C, `agent_start` (no synthetic), no end | `findOpenToolCalls` | `[]` |
| E9 | orphan-heal: dedupe duplicate open starts | BVA (1 vs 2 identical starts) | L1 | automated | stored: `agent_start`, start A, start A | `findOpenToolCalls` | exactly one entry for A |
| E10 | bridge marks synthetic agent_start | state-transition | L1 | automated | bridge with `isAgentStreaming=true`, connection spy | onReconnect path and session_start path | the `agent_start` frame after `replay_complete` carries `data.synthetic === true` at both sites |
| E11 | dashboard-server tool-result skip placeholder | decision-table (heal marker × session resident/ended/archived) | L1 | automated | store holds end{abc, healedBy:"session_ended"}; session (a) resident streaming, (b) resident ended, (c) not resident | `GET /api/sessions/:id/tool-result/abc?pending=1` | (a) not 200 (404 or 202); (b) 200 `{result:"parent session ended", isError:true}`; (c) 200 same |
| E12 | dashboard-server real end unaffected | equivalence | L1 | automated | resident live session; store holds a real end{abc} after a heal end{abc} | GET tool-result/abc | 200 with the real result |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | orphan-heal ADDED: live tick reopens | state-transition | L1 | automated | reducer: start A (Agent), update agentId ag-1 status running, end{healedBy:"session_ended", isError:true, details:{agentId:"ag-1"}} | reduce `tool_execution_update{A, partialResult.details:{agentId:"ag-1",status:"running"}}` | row `toolStatus:"running"`, `toolCalls.get(A).status:"running"`, `duration===undefined`, no `toolDetails.healedBy`; `subagents.get("ag-1").status:"running"`, no `healedBy`/`error`; `isAgentResultNotReceived(...)===false` |
| F2 | real end after reopen | state-transition | L1 | automated | F1 end state | reduce real end{A, isError:false, result:"done", details:{agentId:"ag-1"}} | row `complete` result "done"; subagent `completed` |
| F3 | real terminal not reopened | state-transition (illegal edge) | L1 | automated | A finalized by a real end (no healedBy) | late update for A | `toolStatus` stays `complete` |
| F4 | really-failed subagent not reopened | decision-table (row heal × subagent heal) | L1 | automated | `subagent_failed{ag-1}` with no healedBy; then end{A, healedBy:"session_ended", details:{agentId:"ag-1"}} | live update for A | row reopens to running; `ag-1` stays `failed` with its original error |
| F5 | other heals keep behaviour | equivalence | L1 | automated | row healed `turn_settled`; separately row with subagent `completed` via real event | late update | terminal status, result and heal markers preserved (existing expectations) |
| F6 | D5 marker cleared by real writes | state-transition | L1 | automated | `subagent_failed{ag-1, healedBy:"session_ended"}` | then (a) `subagent_started{ag-1}`, (b) real `subagent_completed{ag-1}`, (c) real Agent end backfill | after each: `subagents.get("ag-1").healedBy === undefined` |
| F7 | chat-view ask_user hide (running row) | equivalence | L1 | automated | messages: toolResult ask_user `toolStatus:"running"` then interactiveUi `status:"pending"` | render filter helper | toolResult hidden (helper returns hide) |
| F8 | end-to-end: dashboard restart mid-Agent keeps card running | state-transition | L3 | automated | harness session running a long tool call (faux `session-death-open-tool` style long bash) | `POST /api/restart` while running, reopen the session | tool row shows running (no failed badge, no "parent session ended"); after the tool finishes the row is `complete` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | orphan-heal server: replay-left-open call healed on death | fault-injection (abort) | L1 | automated | stored: `agent_start`, start A, `agent_start{synthetic:true}`, no end; session ends | `onEnded` path (event-wiring) | one synthesized `tool_execution_end{A, healedBy:"session_ended"}` inserted and broadcast |
| X2 | stale reconcile does not re-poison | fault-injection | L1 | automated | client row reopened (F1); server returns 404 for placeholder (E11a) | `useStaleToolReconcile` tick after 25s | row stays running (no end reduced) |
| X3 | `isIdle` throws on stale ctx | fault-injection (abort) | L1 | automated | ctx whose `isIdle` throws | `isLive(ctx,false)` | returns false, no throw (covered within E5) |
| X4 | `/reload` mid-turn keeps card running | fault-injection | — | manual-only | real pi TUI with an `Agent` subagent running | `/reload` in the TUI | [judgment: requires a real pi runtime and real subagent; verify card stays running and finalizes on the real end] |

---

## Coverage summary

- Requirements covered: 6/6 (orphan-heal transcript replay MODIFIED, server scan MODIFIED, live-tick reopen ADDED, dashboard-server tool-result MODIFIED, chat-view MODIFIED, design D5 marker)
- Scenarios by class: edge 12 · perf 0 · frontend 8 · error 4
- Scenarios by level: L1 22 · L2 0 · L3 1 · manual 1
- Scenarios by disposition: automated 23 · manual-only 1

## New infra needed

- none (F8 reuses the `session-death-open-tool` faux scenario shape from `tests/e2e/session-ended-orphan-heal.spec.ts`; if that scenario's call is too short for a restart window, the existing long-bash scenario is extended rather than a new harness).
