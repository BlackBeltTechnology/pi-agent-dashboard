# Test Plan — add-session-close-plugin-hook

Stage: design   Generated: 2026-10-15

Levels: L1 = vitest unit (`packages/*/src/**/__tests__/*.test.ts`). No rendered-UI surface changes, so there are no L3 rows. No process/OS behavior changes, so there are no L2 rows.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Opt-in close policy | BVA | L1 | automated | `close.idle.afterMs` = 999 / 1000 / 1800000 / 1000.5 / `Infinity` / `NaN` / `"30"` | `pendingPluginRefRegistry.file` with the declaration | 1000 and 1800000 accepted; 999, 1000.5, Infinity, NaN, "30" dropped; one warning per drop naming plugin id + spawn token |
| E2 | Opt-in close policy | EP | L1 | automated | `close.mode` = `"sleep"` / `"archive"` / absent / `"detach"` | file declaration | sleep, archive kept; absent ⇒ `sleep`; `"detach"` ⇒ block dropped + warning |
| E3 | Opt-in close policy (forgery) | EP | L1 | automated | `pluginRef` body `{ closePolicy: { owner: "victim", idleAfterMs: 1000 } }`, no `close` declaration | register with spawn token | session has no `closePolicy`; `closePolicy` key rejected as core-reserved |
| E4 | Opt-in close policy (persistence) | state-transition | L1 | automated | session with `closePolicy {owner:"team", idleAfterMs:1800000, mode:"sleep"}` | `sessionToMeta` → `.meta.json` → `session-scanner` rehydrate | restored session `closePolicy` deep-equals the original |
| E5 | Undeclared sessions unchanged | decision-table | L1 | automated | `enabled` ∈ {false,true} × policy ∈ {durable, ephemeral} × closePolicy ∈ {none, governed}; every session quiescent, idle 2 h, no watcher | `sweepOnce` | reaped iff (enabled ∧ ephemeral) ∨ governed; `enabled:false` + no governed ⇒ probe called 0 times |
| E6 | Declared reaped while feature disabled | BVA | L1 | automated | governed `idleAfterMs:1800000`, `enabled:false`, quiescent | sweep at idle age 1799999 ms and 1800001 ms | first: not killed; second: `killBySessionId` called once |
| E7 | Quiescence vetoes apply to governed | decision-table | L1 | automated | governed session past threshold, one veto at a time: subscriber, grace window, `currentTool`, pending ask, followUp>0, steering>0, terminal in cwd, live child | `decideReap` | `skip` with the matching veto reason for each; `reap("idle")` with none |
| E8 | Governed gears 2/3 | state-transition | L1 | automated | governed streaming session: (a) idle > threshold, queues empty, no watcher; (b) streaming > hardCeiling, cpuIdle, no child, no ask | `decideReap` | (a) `stop-after-turn`; (b) `phantom` |
| E9 | Closer consulted | decision-table | L1 | automated | governed reap candidate; closer returns `"close"` / `"keep"` / none registered | `reapOne` | close ⇒ kill once; keep ⇒ no kill, `closerKeeps`+1, re-evaluated next sweep (closer called again); none ⇒ kill once |
| E10 | Closer isolation | EP | L1 | automated | plugin X closer registered; candidate declared by plugin Y (no closer) and an ephemeral-only candidate | `sweepOnce` with `enabled:true` | X closer called 0 times; both sessions killed |
| E11 | Closer minimal view | EP | L1 | automated | governed session carrying `pluginRefs` of 2 plugins + `principalOwner` | closer invoked | argument keys are exactly `{ sessionId, cwd, reason, idleMs }` |
| E12 | Closer not on other paths | EP | L1 | automated | governed session whose closer returns `"keep"` | user `shutdownSession`; `abortSpawnedRun`; caps reclaim candidate selection | shutdown + abort kill without calling the closer; caps never selects a declared session |
| E13 | Plugin-requested close now | EP | L1 | automated | declared session owned by caller | `requestSessionClose({when:"now"})` | returns true; shutdown hint + `killBySessionId` once; closer not called; `pluginCloseRequests`+1 |
| E14 | Plugin-requested close idle | state-transition | L1 | automated | mode-only declared session (no idleAfterMs), pending `ask_user`, no watcher | `requestSessionClose({when:"idle"})`; sweep; answer ask; settle; sweep | first sweep: no kill; after answer + settled: killed; closer never called |
| E15 | Request survives activity | state-transition | L1 | automated | governed session with `closeRequested`, then `agent_start` (new prompt) | sweep mid-run; then `agent_settled`; sweep | mid-run: no kill (not `stop-after-turn` either); after settle: killed |
| E16 | Request refused | EP | L1 | automated | session declared by other plugin / undeclared / unknown id / ended / `when:"later"` | `requestSessionClose` | returns false, no kill, exactly one warning per call |
| E17 | Close mode archive | EP | L1 | automated | governed `mode:"archive"`, quiescent past threshold | sweep | killed; `archiveOnEnd:true` set and persisted; `mode:"sleep"` sibling ⇒ `archiveOnEnd` unset |
| E18 | Observability | EP | L1 | automated | governed session reaped idle | sweep | reap record reason `idle` with `declared:true` + owner id; ephemeral reap has no `declared` flag |
| E19 | Trust gate | EP | L1 | automated | plugin manifest `priority: 500` | call `registerSessionCloser`, `requestSessionClose` | closer never registered (governed reap proceeds without it); request returns false |
| E20 | Loader: routing only to declaring plugin | EP | L1 | automated | plugin A declares, plugin B registers closer | governed reap of A's session | B's closer not called; core decision path reads no `pluginRef` (A has no closer ⇒ close) |
| E21 | Team: spawn declaration | EP | L1 | automated | team config `idleMinutes` = 30 / 0 | conversation ensure spawns | 30 ⇒ spawn lifecycle carries `close:{idle:{afterMs:1800000},mode:"sleep"}`; 0 ⇒ no `close` |
| E22 | Team: no own idle timer | EP | L1 | automated | team plugin started | inspect timers / `ConversationService` API | no `sweepIdle` method; no 5-min interval registered |
| E23 | Team closer: ensure in flight | state-transition | L1 | automated | team session idle-reapable; ensure for same conversation pending | invoke team closer | `"keep"`; after ensure resolves ⇒ `"close"` |
| E24 | Team restart still immediate | EP | L1 | automated | live team session | `restartConversation` | `abortSpawnedRun({graceful:true})` called at once, no closer consult |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Closer bound | timed unit (fake clock) | L1 | automated | 10 governed candidates, closer never resolves | sweep returns ≤ 5 s fake time; candidates past the budget deferred (not killed); each timed-out call counted in `closerFailures` | one sweep |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Failing closer does not close | fault-injection (abort) | L1 | automated | closer throws | governed reap | no kill; warning logged; `closerFailures`+1 |
| X2 | Failing closer does not close | fault-injection (delay) | L1 | automated | closer resolves after 1500 ms | governed reap | treated as keep at 1000 ms; no kill; `closerFailures`+1 |
| X3 | Failing closer does not close | fault-injection (bad value) | L1 | automated | closer returns `"maybe"` | governed reap | no kill; `closerFailures`+1 |
| X4 | Plugin disabled | state-transition | L1 | automated | team closer registered, then plugin disabled | governed reap | closer removed; session killed (no closer ⇒ close) |
| X5 | Restart drops idle request | state-transition | L1 | automated | `closeRequested` set, server restart (rehydrate) | sweep before idle threshold | no kill (request gone, governed threshold applies) |

## Coverage summary

- Requirements covered: plugin-session-close-hook 7/7 · embed-session-lifecycle (modified) 2/2 · team-agent-sessions (modified) 1/1 · dashboard-plugin-loader (modified) 1/1
- Scenarios by class: edge 24 · perf 1 · frontend 0 · error 5
- Scenarios by level: L1 30 · L2 0 · L3 0
- manual-only: 0

## New infra needed

None. All rows extend existing vitest suites (`packages/server/src/embed-lifecycle/__tests__/`, `packages/team-plugin/src/server/__tests__/` with its `harness.ts`).
