# Test Plan — fix-connect-snapshot-frame-loss

Stage: design   Generated: 2026-09-12

Levels: L1 = vitest (`packages/*/src/**/__tests__/*.test.ts`), L3 = Playwright vs docker harness (`tests/e2e/*.spec.ts`, port from `.pi-test-harness.json#dashboardPort`). Gateway L1 rows use a fake `WebSocket` whose `bufferedAmount` is a settable property and whose `send(data, cb)` records frames and invokes `cb` on demand (exemplar: existing back-pressure tests in `packages/server/src/__tests__/browser-gateway*.test.ts`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ws-frame-delivery-policy / class per type | decision-table | L1 | automated | one message of each type listed in D1 plus `session_updated`, `sessions_reordered`, a per-session event | `frameClassOf(msg)` | state types → `cls:"state"` with key `type` or `type:entityKey`; `terminal_added/updated/removed` for id `t1` → identical key `terminal:t1`; `session_updated`/event → `transcript`; `openspec_update` and `git_head_update` for `/a` → **different** keys |
| E2 | ws-frame-delivery-policy / state never shed | BVA on `bufferedAmount` | L1 | automated | fake ws, `MAX_WS_BUFFER=1000`; `bufferedAmount` ∈ {999, 1000, 1001} | `sendTo(openspec_update /a)` | 999 & 1000 → sent immediately; 1001 → not sent, pending map has 1 entry, transcript drop counter unchanged |
| E3 | ws-frame-delivery-policy / coalesce latest-wins | state-transition | L1 | automated | saturated socket; `openspec_update /a` (v1) then (v2) then `git_head_update /a` | drain (`bufferedAmount=0`) + send-callback fires | exactly 2 frames flushed in order [`openspec_update /a` v2, `git_head_update /a`]; `coalescedState === 1` |
| E4 | ws-frame-delivery-policy / FIFO by first insertion | state-transition | L1 | automated | saturated; defer keys K1, K2, then K1 again | flush | order on the wire is [K1(newest), K2] — superseded key keeps its slot |
| E5 | ws-frame-delivery-policy / byte ceiling | BVA | L1 | automated | `MAX_WS_BUFFER=1000`, saturated; pending bytes = 990; next state frame of `Buffer.byteLength` 10 then 11 | `sendTo` | 10 → deferred (bytes 1000); 11 → `ws.terminate()` called once, `stalledSocketsTerminated === 1`, pending map for that ws deleted |
| E6 | ws-frame-delivery-policy / byte ceiling counts bytes not code units | BVA | L1 | automated | ceiling 100; pending 90; frame whose `.length` is 8 but `Buffer.byteLength` is 12 (non-ASCII change title) | `sendTo` | socket terminated (byte count used) |
| E7 | ws-frame-delivery-policy / one entry per key | EP | L1 | automated | saturated; 100 × `git_head_update /a` | inspect pending map | `size === 1`, `coalescedState === 99` |
| E8 | ws-frame-delivery-policy / `MAX_WS_BUFFER=0` | boundary (no-limit mode) | L1 | automated | `maxWsBufferBytes: 0`, `bufferedAmount = 10_000_000` | `sendTo(state)` | sent immediately, nothing deferred, no timer created |
| E9 | ws-frame-delivery-policy / socket not OPEN | state-transition | L1 | automated | ws `readyState = CLOSING` with pending map non-empty | flush timer tick | no `send` call, no throw; on `close` timer cleared and map deleted |
| E10 | ws-frame-delivery-policy / bootstrap order | state-transition | L1 | automated | 3 known cwds, 2 terminals, pinned dirs | new browser connection | recorded frame sequence: all `openspec_update`(3), `git_head_update`, `pinned_dirs_updated`, `display_prefs_updated`, `reachability_updated`, `terminal_added`(2) appear **before** the single `sessions_snapshot`; no `session_added`/`session_updated`/`sessions_reordered` before it; nothing after it in the same synchronous turn |
| E11 | ws-frame-delivery-policy / transcript doesn't overtake flushable state | state-transition | L1 | automated | pending map non-empty, `bufferedAmount` just dropped to 0, no callback fired yet | `sendTo(transcript event)` | pending state frames are sent first, then the transcript frame |
| E12 | browser-gateway-decomposition / window membership | BVA on window | L1 | automated | one group with 1 live session and ended sessions e1..e10 in `endedSequence` order; 200 other ended sessions elsewhere newer than all e* | `buildSnapshot` | `sessions` contains live + e1,e2,e3 (first-3), not e4..e10; global-120 consists of the 120 newest by `endedAt`; `orders[g]` ⊆ `sessions` ids; `endedTotals[g] === 10` |
| E13 | browser-gateway-decomposition / global window boundary | BVA | L1 | automated | 121 ended sessions, distinct `endedAt`, no live, none pinned | `buildSnapshot` | exactly 120 present; the one with the oldest `endedAt` absent; `endedTotals` sums to 121 |
| E14 | browser-gateway-decomposition / window keyed by group | decision-table | L1 | automated | worktree session (`gitWorktree.mainPath=/p`, `cwd=/p/.worktrees/x`) ended; parent `/p` has a live session | `buildSnapshot` | the worktree session counts toward `/p`'s first-3 and `endedTotals["/p"]`; no key `/p/.worktrees/x` in `endedTotals` |
| E15 | browser-gateway-decomposition / pinned group with no live | decision-table | L1 | automated | group `/q` pinned, 0 live, 5 ended older than the global window | `buildSnapshot(pinned={/q})` | first-3 of `/q` present; unpin → absent |
| E16 | browser-gateway-decomposition / idle counts as non-ended | EP | L1 | automated | group whose only non-ended session has `status:"idle"` | `buildSnapshot` | group receives its first-3 window |
| E17 | browser-gateway-decomposition / `notifyLog` stripped | EP | L1 | automated | live session with 50-entry `notifyLog`, ended session with 3-entry | `buildSnapshot`, `sessions_page` | no row has `notifyLog`; the in-registry object still has it (shallow copy) |
| E18 | browser-gateway-decomposition / 400 KB bound | performance-as-boundary | L1 | automated | fixture: 25 live rows + 4,000 ended rows cloned from `__fixtures__/measured-session.json` shapes, 400 groups, 20 pinned | `JSON.stringify(buildSnapshot())` | `.length ≤ 400 * 1024` |
| E19 | browser-gateway-decomposition / live reorder windowed at choke point | decision-table | L1 | automated | persisted order for `/g` = [live1, e1, e2, e3, e4(out of window), t-term]; broadcast from three different call sites (`session-meta-handler`, `event-wiring` moveToFront, `reattach-placement`) | `broadcast(sessions_reordered)` | every subscriber receives `sessionIds` = [live1,e1,e2,e3] regardless of site |
| E20 | browser-gateway-decomposition / reorder reflects a session that ended after connect | state-transition | L1 | automated | session s ends after snapshot and falls outside the window | `broadcast(sessions_reordered)` | s absent from the projected `sessionIds` |
| E21 | server-openspec-polling / `openspec_get` gates | decision-table | L1 | automated | enabled × optedOut × tracked × hasRoot (all 16 combos) | `getOrPollOpenSpec(cwd)` | disabled → `GLOBAL_OFF` no poll; optedOut → `OPTED_OUT`; untracked → `ABSENT`; tracked+no root → `ABSENT` `hasOpenspecDir:false`; tracked+root → cache hit or `{PENDING placeholder, poll}`; spawn spy called only in the last branch |
| E22 | server-openspec-polling / `openspec/` without `changes/` | EP | L1 | automated | tracked cwd with `openspec/` dir but no `changes/` | `openspec_get` | placeholder `PENDING` with `hasOpenspecDir:true`, then `final:true` `BROKEN · missing-changes-dir` |
| E23 | server-openspec-polling / cache hit replies unicast only | EP | L1 | automated | 2 fake browsers; cached data for `/a` | browser 1 sends `openspec_get` | browser 1 gets one `openspec_get_result{final:true}` with the cached payload; browser 2 gets nothing; no poll |
| E24 | server-openspec-polling / cold miss two-phase reply | state-transition | L1 | automated | tracked `/b`, root exists, cold cache, poll stub resolves data D | `openspec_get {requestId:"r7"}` | requester receives `[{requestId:"r7", final:false, readiness PENDING}, {requestId:"r7", final:true, data:D}]`; other browsers receive the transitional pending and one `openspec_update` with D |
| E25 | server-openspec-polling / final outcome not re-broadcast when unchanged | EP | L1 | automated | second `openspec_get` for `/b` after E24 | — | cache hit; other browsers receive no further frame |
| E26 | server-openspec-polling / concurrent gets share one poll | EP | L1 | automated | 3 browsers send `openspec_get` for cold `/c` in the same tick | — | poll stub invoked once; each requester gets its own placeholder + final with its own `requestId` |
| E27 | server-openspec-polling / mtime gate honoured | EP | L1 | automated | cached list mtime equals current; cache cleared of data but mtime record kept (simulate cold data, warm gate) | `openspec_get` | `pollDirectoryGated` path taken; CLI spawn spy not called when the gate says unchanged (mirrors periodic behaviour) |
| E28 | shared-protocol / union narrowing | type-level | L1 | automated | `openspec_get`, `openspec_get_result`, `sessions_page`, `sessions_page_result`, `sessions_snapshot` with `endedTotals` | `tsc` on a narrowing test file | compiles; `@ts-expect-error` on a missing `requestId` / `offset` fails to compile as expected |
| E29 | session-listing / page merge | EP | L1 | automated | client holds `/g`: [a,b]; page `{sessions:[c,d,b], order:[c,d,b], hasMore:false}` | `useMessageHandler` | sessions = {a,b,c,d}; `sessionOrderMap.get("/g")` = [a,b,c,d]; `pagedCount["/g"] === 3` |
| E30 | session-listing / offset paging boundaries | BVA | L1 | automated | `pageable("/g")` has 101 ids, `PAGE_SIZE=50` | `sessions_page` offset ∈ {0, 50, 100, 101, 5000} | 0→50 ids hasMore true; 50→50 hasMore true; 100→1 id hasMore false; 101→0 ids hasMore false; 5000→0 ids hasMore false, no throw |
| E31 | session-listing / page excludes window ids | EP | L1 | automated | group with first-3 window [e1,e2,e3] and ended sequence [e1..e8] | `sessions_page offset:0` | returns [e4..e8] only |
| E32 | session-listing / page cwd is the group key | decision-table | L1 | automated | worktree ended sessions under parent `/p` | `sessions_page {cwd:"/p"}` vs `{cwd:"/p/.worktrees/x"}` | `/p` returns them; the raw worktree cwd returns 0 with `hasMore:false` |
| E33 | session-listing / live reorder keeps paged ids | EP | L1 | automated | client holds [a,b,p1,p2] with p1,p2 paged | `sessions_reordered {sessionIds:[b,a]}` | order becomes [b,a,p1,p2] |
| E34 | session-listing / unknown ids ignored | EP | L1 | automated | `sessions_reordered {sessionIds:[a, ghost, b]}` with `ghost` not held | apply | order = [a,b]; no error |
| E35 | session-listing / `endedTotals` live | state-transition | L1 | automated | snapshot `endedTotals["/g"]=2`; `session_updated` transitions held `/g` session to ended; then `session_removed` of an ended `/g` session | apply both | 3 then 2 |
| E36 | session-listing / stub group rendering | decision-table | L1 | automated | `endedTotals["/old"]=3`, no held session for `/old`; `/old` assigned to workspace W in prefs | render `SessionList` | a group header for `/old` renders inside W with an expander labelled 3, no session cards, no OPENSPEC/KB/GIT sections; empty group sorts last in recency mode |
| E37 | session-listing / reconciliation set | decision-table | L1 | automated | rendered: live cards for `/a`,`/b`; ended-only cards for `/c`; stub `/d`; selected ended session in `/e`; openspecMap has settled `/a`, pending placeholder `/b` | run hook | `openspec_get` sent for `/b` and `/e` only |
| E38 | session-listing / one in-flight per cwd | EP | L1 | automated | 5 live cards for `/a`, no entry | hook effect re-runs 3× | exactly one `openspec_get` for `/a` until reply/timeout |
| E39 | session-listing / timeout releases | BVA (time) | L1 | automated | fake timers; request at t=0, no reply | t=14.999 s vs 15 s | at 14.999 s re-run sends nothing; at 15 s re-run sends a new `openspec_get` with a new `requestId` |
| E40 | session-listing / reconnect clears in-flight | state-transition | L1 | automated | in-flight `/a`; socket status connected→disconnected→connected, snapshot applied | effect | in-flight cleared; new `openspec_get` for `/a` if still unsettled |
| E41 | session-listing / result applied like update | EP | L1 | automated | `openspec_get_result {cwd:"/w", data:D, final:true}` | handler | `openspecMap.get("/w")` deep-equals D; in-flight `/w` released only on `final:true` (a `final:false` leaves it) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | browser-gateway-decomposition / 400 KB bound | threshold | L1 | automated | E18 fixture | serialized snapshot ≤ 409,600 bytes; also assert live-only part ≤ 100 KB so the bound isn't met by starving the window | single build |
| P2 | ws-frame-delivery-policy / flush latency | timed (fake timers) | L1 | automated | 50 deferred state frames, socket drains with no further send | all 50 flushed within ≤ 250 ms of `bufferedAmount` dropping below threshold | one drain |
| P3 | ws-frame-delivery-policy / steady-state cost | invariant | L1 | automated | 1,000 state sends on an unsaturated socket | zero timers created, pending map never allocated for that ws | run |
| P4 | ws-frame-delivery-policy / memory bound under stall | soak | L1 | automated | socket never drains; 10,000 state frames across 50 keys, each 1 KB; `MAX_WS_BUFFER=20 KB` | retained pending bytes ≤ 20 KB at all times; socket terminated exactly once; process RSS delta < 5 MB | run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | server-openspec-polling / every known cwd reaches the browser | state-convergence | L3 | automated | harness with ≥ 2 pinned openspec-initialised dirs and 1 live session in a third; harness `maxWsBufferBytes` set to 64 KB via config so the bootstrap saturates | load dashboard | within 5 s every folder card and the session card show their OPENSPEC section (`data-testid` of the subcard present); `GET /api/health` → `droppedFrames.coalescedState ≥ 0`, transcript `total` unchanged by the connect |
| F2 | session-listing / reconciliation on reconnect | state-transition | L3 | automated | dashboard loaded; server restarted via `POST /api/restart` | reconnect | after reconnect every rendered live card's OPENSPEC section is present again within 10 s; no duplicate sections |
| F3 | session-listing / stub group expander | state-transition | L3 | automated | harness seeded with one dir whose only session ended before the window (`PI_E2E_SEED` fixture with > 120 ended sessions elsewhere) | click expander | ended list grows by ≤ 50 rows; "more" hidden once held ended count equals the label count |
| F4 | old-bundle compatibility | state-transition | L1 | automated | pre-change `useMessageHandler` reducer snapshot (fixture) receives new-server frames: state frames first, windowed snapshot with `endedTotals`, an `openspec_get_result`, a `sessions_page_result` | apply | no throw; sessions map = windowed set; unknown types ignored |
| F5 | active card display unchanged | golden | L1 | automated | `SessionCard` rendered from a live row with and without `notifyLog` | render | identical DOM |
| F6 | stub group / expander look | visual/subjective | — | manual-only | sidebar with a stub group and a "more" affordance | human looks | [judgment: matches existing folder header styling; affordance discoverable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | server-openspec-polling / poll rejects | fault-injection (abort) | L1 | automated | poll stub rejects with `Error("boom")` | cold `openspec_get` | requester gets `final:true` with `readiness {state:"BROKEN", reason:"cli-failed"}`; in-flight map entry deleted; a subsequent `openspec_get` for the cwd starts a fresh poll |
| X2 | server-openspec-polling / poll stalls | fault-injection (delay) | L1 | automated | poll stub never resolves | `openspec_get` then socket closes | no unhandled rejection; no send on closed socket; in-flight promise still shared by a later request from another browser |
| X3 | ws-frame-delivery-policy / send callback errors | fault-injection | L1 | automated | fake `send` invokes `cb(new Error)` | flush | error logged once (rate-limited), map entry not re-sent, no throw |
| X4 | ws-frame-delivery-policy / terminate during flush | fault-injection | L1 | automated | `terminate()` called by the byte-ceiling path while a flush timer is pending | timer fires | guarded by `readyState`; no send, timer cleared |
| X5 | session-listing / lost final reply | fault-injection (drop) | L1 | automated | server sends placeholder `final:false`, final reply dropped | 15 s | reconciliation re-requests (placeholder is not settled); second attempt's reply settles it |
| X6 | session-listing / page reply lost | fault-injection (drop) | L1 | automated | `sessions_page` sent, reply never arrives | 15 s then click "more" | a new `sessions_page` with the same `offset` is sent |
| X7 | browser-gateway-decomposition / registry mutates mid-build | race | L1 | automated | session ends between `snapshotVisibleIds` and row projection (simulated by a getter that flips status) | `buildSnapshot` | output is self-consistent: every id in `orders` exists in `sessions` |
| X8 | server-openspec-polling / hostile cwd | security | L1 | automated | `openspec_get {cwd:"/etc"}`, `{cwd:"../../"}`, `{cwd:""}` from a paired remote socket | handler | single `final:true` `ABSENT` reply; spawn spy never called; no fs access outside `hasOpenSpecRoot(cwd)` for tracked cwds |

---

## Coverage summary

- Requirements covered: 12/12 (ws-frame-delivery-policy ×5, browser-gateway-decomposition ×1, server-openspec-polling ×2, session-listing ×3, shared-protocol ×3 — shared-protocol's three are covered by E28 jointly)
- Scenarios by class: edge 41 · perf 4 · frontend 6 · error 8
- Scenarios by level: L1 55 · L2 0 · L3 3 · — 1
- Scenarios by disposition: automated 58 · manual-only 1

## New infra needed

- A measured-session fixture file (`packages/server/src/__fixtures__/measured-session.json` or similar) captured from a real ended and live row with `notifyLog` populated, for E18/P1/F5. One-time capture; no new harness.
- Harness config knob to set `memoryLimits.maxWsBufferBytes` for F1 — `docker/.env`/config file already supports the field; needs a documented seed value in the E2E harness only.
