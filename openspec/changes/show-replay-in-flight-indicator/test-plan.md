# Test Plan — show-replay-in-flight-indicator

Stage: design   Generated: 2026-08-10

Both HARD-gate clarifications were resolved before this catalog was written and
are now spec contract: the indicator's handle
(`data-testid="replay-in-flight-pill"` + `role="status"` + `aria-busy="true"` +
i18n accessible name) and `REPLAY_PILL_DELAY_MS = 300` (referenced as a named
constant; L3 fixtures use <100ms fast / >1s slow so they survive a retune).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 first content does not clear | state-transition | L1 | automated | `replayInFlight` set for `s1`, `loadingHistory` set for `s1` | `event_replay { sessionId: "s1", events: [200 events], isLast: false }` | `replayInFlight.get("s1") === true` AND `loadingHistory.get("s1") === false` AND 200 messages reduced into state |
| E2 | R1 terminal clears | state-transition | L1 | automated | `replayInFlight` set for `s1` | `event_replay { events: [1 event], isLast: true }` | `replayInFlight.get("s1") === false` |
| E3 | R1 empty terminal clears | state-transition | L1 | automated | `replayInFlight` set for `s1`, no messages | `event_replay { events: [], isLast: true }` | `replayInFlight.get("s1") === false` AND `loadingHistory.get("s1") === false` |
| E4 | R1 the two flags diverge | decision-table | L1 | automated | `replayInFlight` + `loadingHistory` both set for `s1` | batch A `{events:[e1..e200], isLast:false}` then batch B `{events:[e201], isLast:true}` | after A: `(loadingHistory=false, replayInFlight=true)`; after B: `(false, false)` — asserted as a pair at each step, so collapsing the flags fails loudly |
| E5 | R2 empty warm delta terminates | equivalence-partition | L1 | automated | warm subscribe, `lastSeq` equal to session high-water mark, computed delta `[]` | server sends the replay for that subscribe | exactly ONE `event_replay` frame, equal to `{ events: [], isLast: true }` |
| E6 | R2 cold empty session terminates | equivalence-partition | L1 | automated | cold subscribe, session file parses to zero events, load succeeds | server sends the replay | exactly ONE `event_replay` frame with `isLast: true` on the success path (in addition to the pre-parse `isLast:false` start marker) |
| E7 | R2 exact-batch-size does not double-terminate | BVA | L1 | automated | replay payload of exactly `REPLAY_BATCH_SIZE` (200) events | `sendEventBatches` runs | exactly 1 frame, `isLast: true`, 200 events — NO trailing empty terminal frame |
| E8 | R2 just-above-batch-size | BVA | L1 | automated | replay payload of 201 events | `sendEventBatches` runs | exactly 2 frames; frame 1 `isLast:false` (200 events), frame 2 `isLast:true` (1 event); no third frame |
| E9 | R2 exact multiple of batch size | BVA | L1 | automated | replay payload of exactly 400 events | `sendEventBatches` runs | exactly 2 frames, second `isLast:true` — NO trailing empty terminal frame |

> E7/E9 are the falsification rows for Decision 6: a naive "always append a
> terminal batch" implementation passes E5/E6 but double-terminates here.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R3 indicator renders + handle | state-transition | L1 | automated | `replayInFlight` true for selected session, messages present | `REPLAY_PILL_DELAY_MS` elapses (fake timers) | element `[data-testid="replay-in-flight-pill"]` present, with `role="status"`, `aria-busy="true"`, and a non-empty accessible name |
| F2 | R3 indicator disappears | state-transition | L1 | automated | pill rendered per F1 | terminal `event_replay { isLast: true }` received | pill absent from the tree |
| F3 | R3 skeleton/pill exclusivity | decision-table | L1 | automated | messages empty, `loadingHistory` true, `replayInFlight` true | delay elapses BEFORE first content, then first content batch arrives | before content: `chat-history-skeleton` present AND pill absent; after content: skeleton absent AND pill present — never both simultaneously |
| F4 | R3 empty-session placeholder wins | decision-table | L1 | automated | session with no persisted history | only `event_replay { events: [], isLast: true }` received | "No messages yet" rendered AND pill never rendered |
| F5 | R4 fast replay never paints | BVA | L1 | automated | `replayInFlight` set, fake timers | terminal `isLast:true` at `REPLAY_PILL_DELAY_MS - 1`, then timers advanced well past the threshold | pill absent at EVERY sampled point of the timeline (asserted across the run, not only the end state) |
| F6 | R4 slow replay paints at threshold | BVA | L1 | automated | `replayInFlight` set, fake timers | timers advanced to exactly `REPLAY_PILL_DELAY_MS` with the flag still set | pill present, and still present until the flag clears |
| F7 | R4 pending delay is cancelled | state-transition (illegal edge) | L1 | automated | `replayInFlight` set, delay timer pending | flag cleared at ~250ms, then timers advanced past 300ms | pill absent at and after the threshold instant AND no delay timer remains armed for that session |
| F8 | R4 delay state does not leak across sessions | state-transition (illegal edge) | L1 | automated | pill showing (or delay pending) for session A; `<ChatView>` rendered without a `key` and `React.memo`'d, so the instance is reused | chat view switched to session B whose replay is NOT in flight, timers advanced | pill absent for session B AND no A-armed timer causes it to appear |
| F9 | R3 indicator over a real multi-batch replay | state-transition | L3 | automated | docker harness session large enough to span multiple `event_replay` batches | fresh cold subscribe via the dashboard UI | pill visible while batches stream, absent after the transcript settles; final transcript matches the full event count |
| F10 | R4 warm reload paints nothing | state-transition | L3 | automated | previously-visited, unchanged session (warm rehydrate → `subscribe { lastSeq }` → empty delta) | page reload against the harness | pill never observed AND the transcript renders complete |
| F11 | R3 indicator must not reflow the list | invariant / layout | L3 | automated | multi-batch replay with the pill visible | pill appears, then disappears | bounding box of the last rendered message row is unchanged across both transitions (overlay, not an in-flow row) |
| F12 | R3 pill visual fidelity across themes | visual/subjective | — | manual-only | dashboard on each of studio / earth / athlete / gradient | human inspects the pill mid-replay | [judgment: contrast, placement and motion "look right" and match theme tokens — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R5 data-unavailable clears | fault-injection (abort) | L1 | automated | session history load fails server-side | `session_updated { dataUnavailable: true }` received for that session | `replayInFlight.get(sid) === false` AND pill absent |
| X2 | R5 lost terminal clears at ceiling | fault-injection (drop) | L1 | automated | terminal `isLast:true` never sent | armed safety-net window elapses with no further message | `replayInFlight.get(sid) === false` AND pill absent |
| X3 | R5 clearing is one-way | state-transition (illegal edge) | L1 | automated | flag already cleared by an elapsed ceiling | a further non-terminal `event_replay` batch arrives for that session | flag remains `false` AND pill remains absent |
| X4 | R6 slow transfer does not clear mid-replay | fault-injection (delay) | L1 | automated | non-terminal content batches spaced longer than `SUBSCRIBE_ACK_MS` but shorter than `HYDRATE_CEILING_MS`, total span exceeding `HYDRATE_CEILING_MS` | each batch arrives (fake timers) | flag still set when the final batch arrives AND pill rendered continuously throughout — the direct regression guard for Decision 7 |
| X5 | R6 silent wire still clears | fault-injection (stall) | L1 | automated | a non-terminal batch has just re-armed the ceiling | no message of any kind before the ceiling window elapses | `replayInFlight.get(sid) === false` |
| X6 | R6 backpressure stall keeps the pill | fault-injection (throttle) | L3 | automated | network throttled so a multi-batch replay stalls mid-transfer for >2s | cold subscribe over the throttled link | pill remains visible for the whole stall and clears only once the transcript completes |
| X7 | R7 new client vs old server degrades safely | fault-injection (missing terminator) | L1 | automated | server that does NOT terminate empty replays | subscribe to a session whose replay payload is empty | flag cleared by the safety-net window, no permanent in-flight state, no hang |
| X8 | R7 old client tolerates the terminal batch | compatibility | L1 | automated | client with no `replayInFlight` implementation | receives `event_replay { events: [], isLast: true }` on the empty path | existing `isLast` handling clears `loadingHistory` and renders "No messages yet"; no unknown-message-type path taken |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | R6 re-arm must not churn React state | render-count bound | L1 | automated | 10 consecutive non-terminal `event_replay` batches for one session | committed renders attributable to `replayInFlight` == 0 for batches 2..10 (re-arm touches the timers ref only, never the state setter) | single replay sequence |

> P1 guards the cost of Decision 7: re-arming per batch is only free if it does
> not go through `setReplayInFlight`. A setter-based re-arm would re-render the
> transcript once per batch.

---

## Coverage summary

- Requirements covered: 7/7 (R1 E1–E4 · R2 E5–E9 · R3 F1–F4, F9, F11, F12 ·
  R4 F5–F8, F10 · R5 X1–X3 · R6 X4–X6, P1 · R7 X7–X8)
- Scenarios by class: edge 9 · frontend 12 · error 8 · perf 1 (30 total)
- Scenarios by level: L1 23 · L2 0 · L3 6 · manual-only 1
- Scenarios by disposition: automated 29 · manual-only 1

No L2 rows: this change touches client rendering and one server wire path, with
no install, spawn, or multi-OS runtime surface.

## New infra needed

- `packages/client/src/components/chat/__tests__/` does not exist yet — the
  ChatView rendering rows (F1–F8) create it. Harness glue is available from
  `packages/client/src/components/editor-pane/__tests__/MarkdownViewer.test.tsx`
  (component render + RTL setup); flag-transition glue from
  `packages/client/src/hooks/__tests__/useMessageHandler.loading-history.test.tsx`.
- No new L3 harness: F9/F10/F11/X6 extend the existing docker-harness pattern in
  `tests/e2e/large-session-replay.spec.ts` and
  `tests/e2e/replay-delta-on-reload.spec.ts`. Read the dashboard port from
  `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.
