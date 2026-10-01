# Test Plan — show-session-history-load-state

Stage: design   Generated: 2026-07-29

No clarifications needed: every Triple resolved from the specs + design (10 s
slow threshold, `REPLAY_PILL_DELAY_MS` 300 ms, `SUBSCRIBE_ACK_MS` 15 s,
`HYDRATE_CEILING_MS` 90 s, exact strings and roles).

Levels: **L1** vitest (`packages/client/src/**/__tests__/`), **L3** Playwright
vs the docker harness (`tests/e2e/*.spec.ts`, port from `.pi-test-harness.json`).
No L2 rows — nothing process/install-level changes.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | D1 phase precedence; card table order waiting→loading→failed | decision-table | L1 | automated | all 32 combos of `selected, connected, hasContent, loading, failed` | `deriveHistoryLoadPhase(i)` | waiting iff `selected && !connected && !hasContent`; else loading iff `loading && connected`; else failed iff `failed && connected && !hasContent`; else idle — table-driven, 32/32 match |
| E2 | `hasChatContent` = ChatView empty gate | EP | L1 | automated | (a) `undefined` state, no steering (b) `undefined` state, steering `[x]` (c) state with only `streamingText` (d) only `pendingPrompt` (e) messages `[]` + steering `[]` | call `hasChatContent` | a→false, b→true, c→true, d→true, e→false |
| E3 | Slow-load notice after 10 s | BVA | L1 | automated | `SlowLoadNotice` mounted with `startedAt = t0`, fake timers | advance to t0+9 999 ms, then t0+10 000 ms | at 9 999: renders nothing; at 10 000: renders "Still loading history" + `· 10s` + Retry button |
| E4 | Card arc suppressed for fast loads (show-delay) | BVA | L1 | automated | `SessionStatusChip` phase `loading`, fake timers | advance 299 ms; then 1 ms more; separately flip phase to idle at 250 ms | 299 ms: no ring element; 300 ms: arc ring present; idle-at-250: arc never rendered |
| E5 | `startedAt` rules (a)(b)(c), D2 | state-transition | L1 | automated | `beginLoadingHistory` with timers ref / startedAt ref states: not armed; armed + startedAt present; armed + `restart:true`; armed + startedAt missing | call `beginLoadingHistory(id, opts)` | not armed → set to now; armed+present → unchanged; restart → reset to now; armed+missing → set to now |
| E6 | Ring 3:1 contrast in every palette | BVA (threshold) | L1 | automated | ring tokens `--accent`, `--text-tertiary`, `--status-error` × bg `--bg-primary`, `--bg-tertiary` × every theme palette (9 themes × light/dark) | compute WCAG contrast ratio | every pair ≥ 3.0 |
| E7 | `useNow` relocation keeps old import | EP | L1 | automated | import `useNow` from `lib/access-grants/yolo-status` and from `lib/time/use-now` | render hook with `active=true`, advance 1 000 ms | both are the same function; value advances by 1 000 ms; `active=false` → no interval |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D8: only `SlowLoadNotice` ticks, not ChatView | render-count threshold | L1 | automated | ChatView (React Profiler) with slow notice visible, fake timers | ChatView commit count increase = 0 while notice's own count increases by 5 | 5 s simulated |
| P2 | D6: only `SessionStatusChip` ticks, not SessionCard | render-count threshold | L1 | automated | SessionCard (Profiler) in phase loading, startedAt 12 s ago | SessionCard commit count increase = 0; chip `title` changes 5 times | 5 s simulated |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Reconnect reset (D2): clears failed, startedAt, flags + timers for all | state-transition | L1 | automated | two sessions A (selected) and B (not selected), both loading with armed 15 s timers; B also failed | status `disconnected` → `connected`, then advance 20 s | after transition: failed/startedAt/flags empty for A and B; after 20 s: `markHistoryLoadFailed` never called for B, B phase idle |
| F2 | Server switch clears new + existing maps/timers | state-transition | L1 | automated | session loading with armed timer + failed mark | `clearInMemoryState()` then advance 100 s | all four maps empty; timer callback never runs |
| F3 | Retry = full re-request, restarted clock | state-transition | L1 | automated | `refreshChat` deps spied; loading flag already set, startedAt = now−14 s | call `handleRefreshChat(sid)` | `dropPersisted(sid)` called before `subscribe({lastSeq:0})`; `beginLoadingHistory` called with `{restart:true}`; startedAt == now |
| F4 | ChatView waiting branch | decision-table | L1 | automated | ChatView, messages `[]`, `historyPhase="waiting"`, `loadingHistory=true` | render | "Waiting for connection" inside `role="status"`; no `chat-history-skeleton`; no "No messages yet" |
| F5 | ChatView failed branch + Retry | decision-table | L1 | automated | ChatView, messages `[]`, `historyPhase="failed"` | render; click Retry | "Couldn't load history" inside `role="alert"`; `onRetryHistory` called once; no "No messages yet" |
| F6 | Existing branches unchanged | regression | L1 | automated | ChatView `historyPhase` idle/undefined with (a) `loadingHistory=true` (b) `loadingHistory=false` (c) messages + `historyPhase="waiting"`-impossible → content | render | a → skeleton; b → "No messages yet"; c (messages present, connected=false) → message bubbles, no waiting state |
| F7 | Slow notice announces once | invariant | L1 | automated | `SlowLoadNotice` at 10 s | advance 3 × 1 000 ms | `role="status"` text stays exactly "Still loading history"; `aria-hidden` sibling text goes `· 10s`→`· 13s` |
| F8 | Card ring variants, stacking, a11y | decision-table | L1 | automated | `SessionStatusChip` desktop + mobile × phase loading/waiting/failed/idle × selected true/false | render (past show-delay) | loading → `animate-spin border-t-transparent motion-reduce:animate-none`; waiting → `border-dashed`; failed → error-token border; idle → no ring; ring precedes `StatusShapeBadge` in DOM; `title` contains `<source> — <status>` AND ring text; sr-only ring text has `role="status"` only when selected and never contains digits; mobile variant adds no `w-*`/`h-*` class |
| F9 | Card tooltip seconds tick | state-transition | L1 | automated | chip phase loading, startedAt = now−10 s | advance 2 × 1 000 ms | `title` ends `· 10s`, then `· 11s`, then `· 12s` |
| F10 | SessionList routes phase from map only | EP | L1 | automated | SessionList with 3 sessions, `historyPhaseMap` has only session B → loading | render | only B's chip has a ring; A and C have none |
| F11 | Arm before paint — no empty flash on selection (D3) | convergence invariant | L3 | automated | harness session with ~120-turn transcript (`[[faux:long-transcript]]`), page reloaded so no in-memory state | install MutationObserver recording any "No messages yet" node, then click the session card | observer recorded 0 "No messages yet" nodes from click until transcript renders; skeleton seen |
| F12 | Card arc during real multi-batch replay | convergence | L3 | automated | same long-transcript session, `stallServerToClientWs(page, gap)` | select the card | selected card's chip shows the spinning arc while batches land; arc gone once the last message renders and pill clears |
| F13 | Ring causes no layout shift | invariant (layout) | L3 | automated | card at 1440 px and at 375 px (mobile layout) | record name + timestamp bounding boxes with no ring; trigger loading (stall) so ring shows; record again | boxes identical (±0 px) in both layouts |
| F14 | Ring legibility vs badge / selected glow / stripes across themes | visual/subjective | — | manual-only | studio, earth, athlete, gradient × light/dark | human inspects loading / waiting / failed rings on selected + unselected cards | [judgment: rings read as three distinct states and never obscure the status badge] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Dead-link subscribe fails at the short window | fault-injection (abort) | L1 | automated | no server reply after `subscribe`, session has no content, fake timers | advance 15 000 ms | `loadingHistory` false; failed true; `replayInFlight` false; phase `failed` |
| X2 | Stuck hydration fails at the ceiling | fault-injection (delay) | L1 | automated | cold start marker `event_replay{events:[],isLast:false}` then silence | advance 90 000 ms | failed true; the `replayInFlight` rearm path never invoked `onTimeout` |
| X3 | Timeout after content is not a failure | fault-injection (abort) | L1 | automated | first content batch reduced, terminal never arrives | advance past both windows | failed false; messages still rendered |
| X4 | dataUnavailable marks failed only when loading | decision-table | L1 | automated | `session_updated{dataUnavailable:true}` for (a) a session with armed timer (b) a never-subscribed session | dispatch message | a → failed true; b → failed false, no ring |
| X5 | Late terminal clears failure | state-transition | L1 | automated | session marked failed by timeout | receive `event_replay{events:[],isLast:true}` | failed false; ChatView (connected) renders "No messages yet" |
| X6 | Waiting while disconnected, recovers on reconnect | fault-injection (abort) | L3 | automated | selected empty-in-client session; server→client socket closed (not `setOffline`, which leaves the socket open) | close the WS; later allow reconnect | while down: chat shows "Waiting for connection", card chip dashed ring, no spinner; after reconnect: skeleton then transcript, ring gone |
| X7 | Slow notice + Retry restarts the clock | fault-injection (delay) | L3 | automated | stall all server→client frames for the selected session > 10 s | wait for notice; click Retry; release frames | notice shows "Still loading history" + `· 1Xs`; after Retry the notice disappears; transcript renders |
| X8 | Timeout → failed state → Retry recovers | fault-injection (abort) | L3 | automated | drop every server→client replay frame for the session | wait > 15 s; click Retry with frames restored | chat shows "Couldn't load history" (`role=alert`) + Retry, card chip solid error ring; after Retry: skeleton → transcript, ring gone |
| X9 | Screen-reader experience | assistive-tech/subjective | — | manual-only | VoiceOver on macOS Safari | slow load to 20 s; switch between two loading cards | [judgment: slow notice announced once; only the selected card's state announced; failed alert announced] |

---

## Coverage summary

- Requirements covered: 13/13 (chat delta: 3 modified + 4 added; card spec: 4 added; design-only invariants D2/D3/D6/D8 also covered)
- Scenarios by class: edge 7 · perf 2 · frontend 14 · error 9
- Scenarios by level: L1 24 · L2 0 · L3 6 · — 2
- Scenarios by disposition: automated 30 · manual-only 2

## New infra needed

- none — L3 reuses `stallServerToClientWs` (`tests/e2e/replay-in-flight-pill.spec.ts`) and the
  socket-close reconnect technique in `tests/e2e/paging-exhausted-reconnect-rearm.spec.ts`.
