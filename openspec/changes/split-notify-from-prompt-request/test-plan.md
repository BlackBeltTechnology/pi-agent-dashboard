# Test Plan — split-notify-from-prompt-request

Stage: design   Generated: 2026-08-06

HARD gate cleared — 3 clarifications resolved before writing:
C1 notify-log cap = **50**, oldest-first · C2 log is **retained** for ended
sessions (reapability protected by exclusion, not deletion) · C3 log is
**persisted** alongside the session record.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | notify shape | EP | L1 | automated | `ctx.ui.notify("hello","info")` | bridge proxy runs | emitted frame is `{type:"notify",sessionId,notifyId,message:"hello",level:"info"}`; no `promptId`, no `placement`, no `component` |
| E2 | level optional | EP | L1 | automated | `ctx.ui.notify("hi")` (no level) | bridge proxy runs | frame omits `level`; frame still validates |
| E3 | success level survives | EP | L1 | automated | `ctx.ui.notify("done","success")` | bridge proxy runs | frame carries `level:"success"` |
| E4 | unrecognized level normalized at send site | EP (invalid class) | L1 | automated | `ctx.ui.notify("x","debug")` | bridge proxy runs | frame carries `level:"info"`; no cast at send site |
| E5 | legacy level normalized server-side | EP (invalid class) | L1 | automated | `prompt_request{prompt.type:"notify", component.props.level:"debug"}` | server guard normalizes | delivered notify carries `level:"info"` |
| E6 | notify-log cap — at cap | BVA | L1 | automated | session with 49 logged notifies | 50th arrives | log length 50; zero evictions |
| E7 | notify-log cap — just past cap | BVA | L1 | automated | session with 50 logged notifies | 51st arrives | log length 50; entry #1 evicted; #51 present |
| E8 | notify-log cap — empty | BVA (min) | L1 | automated | session with 0 notifies | browser subscribes | `replayNotifyLog` sends nothing; no error |
| E9 | dedup by notifyId not text | EP | L1 | automated | two notifies, identical `message`, distinct `notifyId` | both delivered | two chat rows render |
| E10 | protocol discriminant | decision-table | L1 | automated | union member `"notify"` | consumer switches on `type` | `"notify"` statically known; send site compiles without `as any` |
| E11 | genuine prompt_request unaffected | decision-table | L1 | automated | `prompt_request{prompt.type:"select"}` | server branch runs | tracked + folded + unread-stamped + reordered exactly as before |
| E12 | notify never enters PromptBus | EP | L1 | automated | `ctx.ui.notify(...)` called | bridge proxy runs | `promptBus.getPendingRequests()` gains no entry; bridge reconnect resend omits it |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | chat row, no pending request | state-transition | L1 | automated | `notify` message | main-app reducer handles it | `messages` gains one `interactiveUi` row keyed `ui-<notifyId>`; `interactiveRequests` unchanged (length 0) |
| F2 | both reducers covered | state-transition | L1 | automated | same `notify` message | embed session-state reducer handles it | same invariant as F1 — row added, `interactiveRequests` empty |
| F3 | transcript position preserved | state-transition | L3 | automated | assistant msg → notify → assistant msg | transcript renders | notify row renders between the two assistant rows |
| F4 | notify survives browser refresh | state-convergence | L3 | automated | session has 1 delivered notify | browser reloads and re-subscribes | notification row present after reload; converges to same transcript |
| F5 | warm reconnect does not duplicate | state-transition (illegal edge) | L3 | automated | notify already delivered live | socket drops → delta re-subscribe → `replayNotifyLog` fires | exactly one row for that `notifyId` |
| F6 | ended session keeps rows | state-transition | L3 | automated | session with notifies is unregistered | browser opens the ended session | notification rows still render |
| F7 | log survives server restart | state-transition | L2 | automated | session with delivered notifies | `POST /api/restart`, then re-open session | notifications still delivered; transcript matches pre-restart |
| F8 | no "Needs you" on a notify-only session | state-transition | L3 | automated | freshly spawned session, ≥1 notify, no genuine prompt | card renders at rest | card reads "Idle"; no needs-you dot/rail/stripes; folder needs-you pill count unchanged |
| F9 | genuine ask_user still shows "Needs you" | state-transition (pinned negative) | L3 | automated | session issues a real `ask_user` | card renders | card reads "Needs you" with needs-you styling |
| F10 | renderer output unchanged | visual/subjective | — | manual-only | a notify of each level | human compares to pre-change render | [judgment: row looks identical — colour, spacing, markdown] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | notify for unknown session | fault-injection (bad input) | L1 | automated | `notify` for an id the server does not own | server dispatch | dropped: no delivery, no log entry, no session-state write |
| X2 | notify for ended session | fault-injection (bad input) | L1 | automated | `notify` for a session whose status is `ended` | server dispatch | dropped, same as X1 |
| X3 | no re-arm after a turn (new shape) | state-transition | L1 | automated | session received a `notify`, no genuine prompt | `tool_execution_start{bash}` → `tool_execution_end` | `currentTool === null` after the end event, NOT `"ask_user"` |
| X4 | no re-arm after a turn (legacy shape) | state-transition | L1 | automated | session received `prompt_request{prompt.type:"notify"}` | `tool_execution_start{bash}` → `tool_execution_end` | `currentTool === null` after the end event |
| X5 | genuine prompt still re-arms | state-transition (pinned negative) | L1 | automated | session has a genuine pending prompt | `tool_execution_end` | `currentTool === "ask_user"` — unchanged from `restore-ask-user-tool-state-on-reconnect` |
| X6 | notify raises no pending ask | fault-injection (state probe) | L1 | automated | session with notifies only | reaper quiescence gate evaluated | `hasPendingPromptRequests === false`; `hasPendingAsk` union false; session reapable |
| X7 | retained log on a dead session is still reapable | fault-injection (state probe) | L1 | automated | ended session whose notify log is non-empty | reaper evaluates it | `hasPendingAsk` false; session eligible for reclamation |
| X8 | notify does not mark unread / reorder | state-transition (illegal edge) | L1 | automated | live session, no browser viewing it | `notify` arrives | session NOT marked unread; `questionFirst` reorder does NOT fire; no `session_updated` broadcast |
| X9 | old bridge → new server delivers | fault-injection (version skew) | L1 | automated | old-bridge `prompt_request{prompt.type:"notify"}` | server guard runs | subscribers receive the normalized `notify`, never the raw `prompt_request`; registry untouched |
| X10 | old server → new bridge is silent | fault-injection (version skew) | — | manual-only | new bridge + a pre-change server | notify emitted | [judgment: accepted regression per design Decision 9 — confirm no crash, notification simply absent] |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | log is bounded under a chatty emitter | threshold | L1 | automated | 10 000 notifies to one session | log length stays ≤ 50; retained-bytes bounded | single run |

---

## Coverage summary

- Requirements covered: 11/11 (7 `notify-message-channel`, 1 `prompt-derived-tool-state` MODIFIED, 1 `bridge-extension` MODIFIED, plus the 2 pinned negatives)
- Scenarios by class: edge 12 · frontend 10 · error 10 · perf 1 — **33 total**
- Scenarios by level: L1 23 · L2 1 · L3 7 · manual-only 2
- Scenarios by disposition: automated 31 · manual-only 2

## New infra needed

None. L1 extends the existing `packages/server/src/__tests__/prompt-derived-tool-state.integration.test.ts` harness and the sibling client reducer tests; L3 extends the existing Playwright docker-harness specs (read the port from `.pi-test-harness.json#dashboardPort`, never a hardcoded `:18000`); L2 uses the existing `/api/restart` smoke path.
