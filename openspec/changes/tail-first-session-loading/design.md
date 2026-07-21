# Design — Tail-First Session Loading

## Context

Session open today streams the full stored event range oldest→newest in 50-event `event_replay` batches (`subscription-handler.ts` `sendEventBatches`). While a subscriber's replay is in flight, live `event` broadcasts to that WebSocket are suppressed and delivered as a catch-up batch at the end (`markReplaying`/`clearReplaying`), because the client's reset heuristic (`shouldReset = firstSeq === 1 || firstSeq <= maxSeq`, `useMessageHandler.ts` + `useSessionState.ts`) misfires if a live event bumps `maxSeq` between batches. Cold loads parse the whole JSONL in a worker (`session-load-worker-pool`), insert every event into the memory store, then run the same full batch cascade.

Real workload (quikdive): 261 session files, top files 17–47 MB / 1 600–4 000 JSONL lines, each line expanding to multiple protocol events. Consequences the user feels: seconds of old history building top-down before the recent turn appears; prompts sent during load produce no visible stream until replay ends.

Constraints:
- The event reducer (`reduceEvent`) is order-dependent: `message_start → message_update → message_end` pairing, tool start/end pairing, model/stat accumulation. Events cannot be folded out of order or from a mid-span start.
- `seq` is assigned per session in arrival/entry order and is the delta-subscribe cursor; it must stay dense and stable.
- The IndexedDB replay cache (Strategy A) persists a raw-event tail and re-subscribes with `lastSeq = persistedMaxSeq`.
- Plugin-runtime `useSessionEvents` consumers refold the raw per-session event array; the shell reducer refolds `SessionState`.
- ChatView transcript is virtualized (TanStack) and bottom-anchored.

## Goals / Non-Goals

**Goals:**
- Time-to-recent-content on session open bounded by one tail window, not total history size.
- Prompt send + live streaming usable while older history is still absent/backfilling.
- Scroll-up pagination (Slack model) until seq 1, with end-of-history signal.
- Replace the `firstSeq <= maxSeq` reset inference with explicit wire metadata.
- Cold (disk) loads serve the tail as soon as events exist, without waiting for the full buffer insert + full-stream send.

**Non-Goals:**
- Bridge→server transfer efficiency (`replaySessionEntries` full resend on reconnect) — separate change.
- Server-side reduced-state snapshots (protocol v2 territory).
- Render-layer memoization/virtualization work — owned by `memoize-chatview-to-fix-input-lag` / `reduce-chat-render-cpu-umbrella`.
- Persisting paginated older windows to IndexedDB.

## Decisions

### D1. Wire shape: `event_replay` gains window metadata; new `load_older` request

`event_replay` gains `kind: "tail" | "older" | "delta"` and `hasOlder: boolean`. New browser→server message `load_older { sessionId, beforeSeq, limit? }`; the server responds with `event_replay { kind: "older", events, hasOlder }` covering a bounded range ending at `beforeSeq - 1`.

- Client behavior is switched on `kind`, not on seq heuristics:
  - `tail` → reset state, fold window, set `maxSeq` from window end.
  - `delta` → append-fold (reconnect/warm path, unchanged semantics).
  - `older` → prepend to raw buffer + full refold (D3). MUST NOT touch `maxSeq`.
- Alternative considered: keep heuristics and infer "older" from `lastSeq(batch) < maxSeq`. Rejected — this is exactly the fragile inference class that forced the suppression machinery; explicit metadata is one field and removes a whole bug family.
- Compatibility: `kind` is additive. A client without `kind` support never sends `load_older`, and the server treats a `lastSeq:0` subscribe from it identically (tail window is still a valid full-replay-shaped batch with `firstSeq > 1`; the legacy client's `firstSeq <= maxSeq` rule handles it as reset only if it had prior state — acceptable because dashboard client and server ship together; no cross-version support promised).

### D2. Tail window selection: budgeted, snapped to a safe cut point

Tail window = the newest events, target budget `TAIL_WINDOW_EVENTS = 200`, with the window start **extended backward to the nearest safe cut point**: a position where no message span or tool span is open (i.e. immediately before a `message_start` whose preceding event is not inside an open span; in practice the start of a turn). Hard cap `2 × TAIL_WINDOW_EVENTS`; if no safe point exists within the cap, cut at the cap and drop leading orphan span fragments client-side (reducer already ignores `message_update` without a live message — verify in tasks; if it does not, add a guard in the fold entry point, not in `reduceEvent` core).

- Why event-count budget, not turns: turn sizes vary wildly (subagent floods); a count budget bounds bytes and reduce time deterministically. Snapping supplies the ordering safety.
- Same selection logic is reused by `load_older` for window starts, so every window is safe-cut at both construction sites.
- `stats_update`/`model_change` accumulated before the window are absent until backfill; the session's persisted `.meta.json` stats (already forwarded via `session_updated` and `contextWindow` override) cover the header surfaces. Accepted gap: token-stats bar may show window-local values until older pages load.

### D3. Client fold model: raw buffer is the source of truth; prepend triggers full refold

The client already owns a raw `{seq, event}[]` buffer per session (`replayPersister` buffers). Promote it to the authoritative fold input:

- `tail`/`delta`/live events append (dedup by seq) and fold incrementally (current behavior).
- `older` prepends the window, then **refolds `SessionState` from the full buffer** through the pure reducer, and re-publishes the plugin store (`clearSessionEvents` + `publishSessionEvents(fullBuffer)`) — same rebuild the cold-load path performs today, so cost is bounded by the existing accepted cost. Incremental "fold into existing state from the middle" is forbidden by the reducer contract.
- Refold runs inside the existing `setSessionStates` updater (still synchronous); a 200-event window over a few thousand buffered events is well under the current cold-load fold cost. If profiling shows jank, chunking goes into the umbrella perf change, not here.

### D4. Suppression narrows to the tail window; `older` bypasses it entirely

- Warm subscribe (`lastSeq: 0`, events in memory): server `markReplaying`, sends ONE tail window (≤ 400 events, ≤ 8 batches of 50), `clearReplaying` with catch-up. Suppression window shrinks from "entire history" to "one window" — prompt-send during open streams almost immediately.
- `load_older` responses are sent outside the replaying bookkeeping: they carry only seqs `< beforeSeq`, the client never advances `maxSeq` from them (D1), so live interleave cannot corrupt ordering by construction.
- Delta subscribes (`lastSeq > 0`) keep existing suppress+catch-up unchanged.
- Stale-`lastSeq` reset (client ahead of server) now replies `session_state_reset` + `kind:"tail"` window instead of full replay from seq 1 — strictly less traffic, same correctness (client refetches older lazily).

### D5. Cold load: tail delivery decoupled from buffer fill

Worker parse stays as-is (full JSONL → full event list; seq assignment needs the full branch, so no reverse-parse in this change). What changes is delivery:

1. Worker resolves → server computes the tail window and sends it to all waiting subscribers immediately (`kind:"tail"`, `hasOlder`).
2. The full event list is inserted into the memory store in **yielding chunks** (setImmediate between slices) so the insert of a 40 MB session doesn't block the event loop; `load_older` for that session awaits the fill promise before answering.
3. Hydration heartbeat behavior unchanged while the parse runs; the tail send clears the loading flag (existing `events.length > 0` rule).

Reverse/partial JSONL parse (true tail-first parse) is explicitly deferred: seq numbering and branch reconstruction (leaf→root parent walk) make it a separate optimization with its own risk budget; the measurement task (performance-optimization) records parse-vs-delivery split so we know whether it is ever needed.

### D6. Scroll-up trigger + virtualizer anchoring

- ChatView fires `onLoadOlder` when the virtualizer's first visible row index drops below a threshold (e.g. < 10) and `hasOlder` is true and no older-request is in flight (single-flight per session).
- A slim "loading older…" row renders at the top while in flight (reuses Skeleton, not the full-screen loading state; `chat-history-loading-indicator` full-screen path stays reserved for the initial tail).
- On prepend, preserve the visual anchor: record the first visible row key + its offset before state apply, then after the refold render, scroll so that row lands at the same offset (TanStack `scrollToIndex` with the re-located index via `virtualRowKey`). Keys are content-stable (seq-derived), so relocation is a map lookup.

### D7. Replay cache persists the tail only

`replayPersister.seed` on `kind:"tail"`; `record` on `delta`/live; `older` windows are NOT recorded (buffer split: persist-eligible tail segment tracked by the seed boundary). Cache hit pre-seeds state + buffer and subscribes `lastSeq = persistedMaxSeq` (unchanged); server answers `delta`, and `hasOlder` on the delta tells the client whether scroll-up pagination is available below the persisted window. Cache stays bounded regardless of how far the user paginates.

## Risks / Trade-offs

- [Reducer breaks on mid-span window start when the 2× cap forces an unsafe cut] → fold entry point drops leading orphan `message_update`/`message_end`/`tool_execution_end` events until the first safe event; unit-test with synthetic mid-tool cuts.
- [Prepend refold cost grows with pagination depth (10+ pages → tens of thousands of events)] → refold cost equals today's accepted cold-load fold; additionally `hasOlder` pagination is user-driven (rarely deep). If profiling flags it, chunked refold moves to the perf umbrella.
- [Virtualizer anchor jump on prepend] → anchor-preservation logic in D6; Playwright E2E asserts scroll stability on load-older.
- [Plugin-store republish on every older page re-notifies slot consumers] → `publishSessionEvents` is one spread + one notify; flows/goal reducers are pure over the array. Measured in the perf task; acceptable.
- [Window-local stats until backfill (token bar, butterfly chart)] → header stats ride `session_updated` (server-extracted from full event list on cold load; live sessions have live stats). Documented gap for warm evicted-tail edge only.
- [Two window-construction sites (subscribe tail, load_older) drifting] → single shared `selectWindow(events, beforeSeq?, budget)` helper in the store or handler module; both call it.

## Migration Plan

1. Protocol additions (shared) — additive, no version gate needed (client+server ship together).
2. Server: `selectWindow` + tail-first subscribe + `load_older` + chunked cold-load insert.
3. Client: kind-driven handling + refold path + scroll trigger + anchoring.
4. Replay-cache seed-boundary adjustment.
5. Rollback: revert client to `lastSeq:0` full-replay handling; server keeps `kind` fields (ignored by old client). Single-repo revert is clean.

## Open Questions

- `TAIL_WINDOW_EVENTS` default (200 chosen from 50-batch granularity × typical turn size) — tune with the measurement task on quikdive sessions.
- Should `load_older` window size equal the tail budget or be larger (fewer round-trips when the user drags the scrollbar to the top)? Start equal; revisit after E2E feel.
- Does `reduceEvent` already tolerate orphan `message_update` (no live message)? Task verifies; guard added only if needed.
