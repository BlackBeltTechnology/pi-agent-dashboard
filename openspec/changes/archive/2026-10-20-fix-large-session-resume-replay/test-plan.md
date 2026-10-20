# Test Plan — fix-large-session-resume-replay

Stage: design   Generated: 2026-10-24

Timing seams: scenarios marked *(seam)* run against a real server with the replay idle/cap durations shortened through the controller's injected timers (design D2); the constants under test stay 5 s / 60 s in the controller unit tests (E5, E6). Keepalive interval = existing `HYDRATE_HEARTBEAT_MS` (10 000 ms), shortened the same way where marked.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | event-wiring: A marked replayed event is never live | state-transition | L1 | automated | session with manual attachment `change-a`, `pendingReplaceProposal: null`, `unread: false`, no viewer; replay cap exited *(seam)* | marked `event_forward { replay: true }` `tool_execution_start` Write `openspec/changes/change-b/proposal.md` + a marked event satisfying `isUnreadTrigger` | `pendingReplaceProposal` stays `null`; `unread` stays `false`; push `fanout` spy 0 calls; `lastActivityAt` unchanged; no `event` frame to the browser |
| E2 | event-wiring: Bridge replay mode spans the whole replay (unmarked) | state-transition | L1 | automated | old-bridge register (no marker), manual attachment `change-a` | 13 unmarked events 450 ms apart (~5.9 s), then unmarked Write `change-b`, then `replay_complete` | `pendingReplaceProposal` unset; no `session_updated` carrying `change-b` (spike S1b) |
| E3 | event-wiring: marked events in a skipped replay never inserted | decision-table | L1 | automated | register skipped the wipe (bridge-learned, matching `eventCount` + `leafEntryId`); store holds N events | idle exit *(seam)*, then 20 marked `event_forward` | store count stays N |
| E4 | event-wiring: Unmarked events after replay_complete are live | state-transition | L1 | automated | registered session, `unread: false`, no viewer | `replay_complete`, then unmarked `agent_end` satisfying `isUnreadTrigger` | `unread` becomes `true`; `fanout` called once with `unreadEdge: true` |
| E5 | event-wiring: idle exit boundary | BVA | L1 | automated | controller with fake clock, `begin` at t=0 | `touch` at 4 999 ms; then silence | no exit at 5 000 ms; exit cause `idle` at 9 999 ms (5 000 after last touch), not at 9 998 |
| E6 | event-wiring: cap exit boundary | BVA | L1 | automated | controller with fake clock, `begin` at t=0 | `touch` every 1 000 ms | no exit at 59 999 ms; exit cause `cap` at 60 000 ms |
| E7 | event-wiring: One replay exit timer per session | state-transition | L1 | automated | old bridge, manual attachment `change-a` | register → `replay_complete` → re-register at 4 s → unmarked Write `change-b` at 5.3 s | session still replaying at 5.3 s; `pendingReplaceProposal` unset (spike S2) |
| E8 | event-wiring: Late replay_complete after an idle exit is a no-op | state-transition | L1 | automated | idle exit ran *(seam)*, no bridge event since | `replay_complete` | 0 additional `event_replay` frames; 0 additional `session_updated` |
| E9 | event-wiring: marked event after exit reopens replay | state-transition | L1 | automated | browser subscribed; marked replay, cap exits before its last 30 events *(seam)* | last 30 marked events, then `replay_complete` | browser receives every stored event through a second exit flush ending `isLast: true`; none as live `event` frames |
| E10 | event-wiring: Prompt re-sends keep the replay alive | state-transition | L1 | automated | controller, fake clock | no `event_forward` for 6 s but `prompt_request` every 2 s | no idle exit during the 6 s |
| E11 | incremental-event-sync: Bridge event count for skip-wipe detection | decision-table | L1 | automated | rows: (a) bridge-learned count+leaf match; (b) old bridge, count match, no leaf; (c) hydration fp count+leaf match, `liveTailOpen:false`, store unchanged; (d) leaf mismatch; (e) `liveTailOpen:true`; (f) `liveTailOpen` absent; (g) heal event inserted after hydration; (h) no fingerprint (leaf undefined); (i) `eventCount` absent | `session_register` | skip (no `deleteEventsForSession`, no `session_state_reset` at register) only for (a) and (c); full wipe + reset for (b),(d)–(i) (spike S4 = row c) |
| E12 | incremental-event-sync: `leafEntryId` validation | BVA | L1 | automated | hydration fp with leaf `x` | register with `leafEntryId` = `""`, `"x"` (len 1), 128-char, 129-char, `42` (number) | len-1 and 128-char matching ⇒ eligible; `""`, 129-char, number ⇒ treated absent ⇒ full wipe |
| E13 | incremental-event-sync: fingerprint leaf parity | EP | L1 | automated | fixtures: linear transcript; branched with `branch_summary`; file with `type:"leaf"` pointer; cyclic parentage; last entry without id | load via worker → `LoadResult`; compare with pi-core `SessionManager.open(f).getBranch()` | linear + branched: `entryCount` and `leafEntryId` equal pi-core's; leaf-pointer + cyclic: differ (⇒ wipe); no-id: `leafEntryId` undefined, no fingerprint |
| E14 | incremental-event-sync: The bridge marks replayed events | state-transition | L1 | automated | bridge with 5-entry branch | reconnect (`sendStateSync` + replay), fresh register, session switch | every replay `event_forward` has `replay: true`; first forward after `replay_complete` has none; register carries `leafEntryId` = last branch id; switch path sends `liveTailOpen: false` |
| E15 | incremental-event-sync: ACP reattach replay is marked | state-transition | L1 | automated | ACP adapter with 3-event durable log | reattach (`reconnected`) | 3 `event_forward` with `replay: true` before `replay_complete`; held live messages after it unmarked |
| E16 | design D7: liveTailOpen computed once | decision-table | L1 | automated | `isLive` stub returning `true` then `false` on successive calls | reconnect register + replay | register `liveTailOpen` equals the replay's `liveTailOpen` option |
| E17 | fork-from-message: OpenSpec state cleared on idle or cap exit | state-transition | L1 | automated | session with `openspecPhase: "apply"`, `openspecChange: "x"` at register | idle exit *(seam)* without `replay_complete` | both fields `null`; one `session_updated` carries them |
| E18 | prompt-derived-tool-state: Every replay exit reconciles | state-transition | L1 | automated | tracked prompt `p1` with lost dismiss; replay re-sends none | idle exit *(seam)*; separately unregister mid-replay | idle: `p1` dropped, `currentTool` re-derived to `null`; unregister: no reconcile call, registries cleared by unregister |
| E19 | proposal-attachment: A bridge replay neither raises nor clears a pending replacement | decision-table | L1 | automated | (a) live events set `pendingReplaceProposal: "change-b"` then reconnect; (b) `"change-b"` at register, user accepts during replay | replay + `replay_complete` | (a) still `"change-b"`; (b) stays `null`, `attachedProposal` = `"change-b"` |
| E20 | event-wiring: Every replay exit logs its cause | EP | L1 | automated | 4 sessions | exits via `complete`, `idle`, `cap` *(seam)*, `unregister` | one `[replay] exit <id> cause=<cause>` line each; `idle`/`cap` at warn level |
| E21 | on-demand-session-replay: The bridge replay-exit flush is windowed | BVA | L1 | automated | `maxReplayEvents: 2000`, browser subscribed | wiped register + 3,000 non-compactable events + `replay_complete` | exactly 1 `session_state_reset`, 1 `history_window`, every `event_replay` ≤ 2,000 events, last `isLast: true` (spike S3) |
| E22 | on-demand-session-replay: flush with windowing disabled on a trimmed store | BVA | L1 | automated | `maxReplayEvents: 0`; store head-trimmed (first seq 501) | replay exit | exactly 1 `session_state_reset` before batches; no `history_window`; all stored events delivered |
| E23 | on-demand-session-replay: In-process subscriber gets the full stream | EP | L1 | automated | in-process subscriber + WS browser, `maxReplayEvents: 2000` | 3,000-event replay exit | in-process handler receives all 3,000; WS browser windowed |
| E24 | incremental-event-sync: kept store equals the bridge replay apart from accepted differences | EP | L1 | automated | fixture transcript (12 entries, closed tail) | hydrate via worker; separately `replayEntriesAsEvents(…, { liveTailOpen: false })` as the bridge does | event streams equal after normalising `timestamp` and context-window fields only |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | on-demand-session-replay: windowed flush at issue scale | threshold | L1 | automated | 15,213 `event_forward` (~80 MB, issue-shaped as `spike/spike-replay-walltime.test.ts`), `maxReplayEvents` default 2,000, one browser | largest `event_replay` frame ≤ 2,000 events (develop baseline: 1 frame, 11,203 events) | one register → flush |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | incremental-event-sync: No cold hydration during a bridge replay | state-convergence | L1 | automated | ended session with `sessionFile`, empty store; bridge registered, no event stored yet | browser subscribes; keepalive interval elapses *(seam)*; then replay + `replay_complete` | `loadSessionEvents` spy 0 calls; immediate `event_replay {[] , isLast:false}`; ≥1 keepalive while waiting; flush ends `isLast:true`; 0 non-terminal markers after it |
| F2 | server-session-reader: Session without sessionFile subscribed during a bridge replay | state-convergence | L1 | automated | session with no `sessionFile`, empty store, bridge replaying | browser subscribes, then `replay_complete` | no `session_updated { dataUnavailable: true }`; browser gets events from the flush ending `isLast:true` |
| F3 | on-demand-session-replay: A superseded replay-exit flush stops and unmutes | state-convergence | L1 | automated | exit flush of 6,000 events draining (batch yields) | bridge re-registers (wipe) mid-drain | no old-flush batch after the new `session_state_reset`; after the new flush, a live `event` reaches the browser |
| F4 | on-demand-session-replay: Abort followed by a skipped register | state-transition | L1 | automated | flush aborted by a re-register that skips the wipe | `replay_complete` of the second replay | full flush (1 reset, ends `isLast:true`) sent; subsequent live `event` delivered |
| F5 | on-demand-session-replay: Empty store still ends the wait | BVA | L1 | automated | waiting browser, nothing stored | replay exit | browser receives `event_replay { events: [], isLast: true }` |
| F6 | chat-history-loading-indicator: Heartbeats while a subscriber waits for a bridge replay | state-convergence | L1 | automated | waiting subscriber *(seam: keepalive 50 ms)* | replay runs 200 ms, then flush; separately subscriber socket closes | ≥2 keepalives before the flush; 0 after `isLast:true`; 0 to a closed socket |
| F7 | resume of a large session in the UI | state-convergence | L3 | automated | docker harness session with ≥ 3,000 events including a historical Write to another `openspec/changes/<x>/` while a different change is attached | bridge reconnect (`npm run reload` in harness) with a second browser context subscribed | no `[data-testid="replace-proposal-dialog"]`; transcript renders with the history-window affordance; no `event_replay` frame > `maxReplayEvents` events on the wire |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | incremental-event-sync: Register during a slow cold load | fault-injection (delay) | L1 | automated | 20,000-entry transcript load in flight | bridge registers + 50 replayed events + `replay_complete` | store holds exactly the bridge's events (50), no hydrated copy (spike S5) |
| X2 | incremental-event-sync: Register after the load resolved but before its insert | fault-injection (delay) | L1 | automated | load promise resolved but `.then` held (fake promise) | register, then release the `.then` | 0 hydrated events inserted |
| X3 | incremental-event-sync: Register during the hydration fan-out | fault-injection (delay) | L1 | automated | hydration of 6,000 events inserted, fan-out mid-batches | register that wipes | no hydration batch reaches the browser after the register's `session_state_reset` |
| X4 | event-wiring: Unregister ends the replay and releases its state | fault-injection (abort) | L1 | automated | session replaying with a waiting browser | `session_unregister` | no idle/cap exit afterwards (timers spy); waiter keepalive stops; waiter receives `isLast:true`; controller record gone |
| X5 | event-wiring: A busy server does not cause an idle exit | fault-injection (delay) | L1 | automated | unmarked replay; server event loop blocked 6 s by a sync busy-wait while the bridge keeps sending | block ends | idle period re-armed (no `cause=idle` log) when the input handled after the block contains bridge messages |
| X6 | event-wiring: bridge dies mid-replay without unregister | fault-injection (abort) | L1 | automated | waiting browser; bridge stops sending after 100 events, socket left open | 5 s of silence *(seam)* | idle exit flushes the 100 events ending `isLast:true` |
| X7 | design D4: flush failure contained | fault-injection (abort) | L1 | automated | `sendTo` throws for one subscriber during the exit flush | replay exit | error logged once; no unhandled rejection; other subscribers still receive the flush |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | proposal Why (#929 freeze) | exploratory | — | manual-only | real ≥ 6,500-entry session in the local dashboard | resume it | [judgment: UI stays responsive during resume; no Replace-proposal dialog — no automatable "responsive" signal beyond P1/F7] |

---

## Coverage summary

- Requirements covered: 24/24 (event-wiring 7, incremental-event-sync 4, on-demand-session-replay 3, proposal-attachment 1, fork-from-message 1, prompt-derived-tool-state 1, server-session-reader 1, chat-history-loading-indicator 1, design-only D4/D7 rules 2, proposal Why 1, perf 1, UI 1)
- Scenarios by class: edge 24 · perf 1 · frontend 7 · error 7 · manual 1
- Scenarios by level: L1 38 · L2 0 · L3 1
- Scenarios by disposition: automated 39 · manual-only 1

## New infra needed

- Test seam on the replay exit controller for idle/cap durations reachable from `createServer` in tests (design D2 already injects timers; expose the durations to the server factory).
