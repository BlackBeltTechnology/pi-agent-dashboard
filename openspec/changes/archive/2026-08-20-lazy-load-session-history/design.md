## Context

Reopening a long session replays the full stored stream to the browser. Three call sites in `packages/server/src/browser-handlers/subscription-handler.ts` feed `sendEventBatches`:

| Site | Condition | Input |
|---|---|---|
| `:242` | `lastSeq > 0 && lastSeq > maxSeq` (stale — client ahead of server) | full stream from seq 1 |
| `:260` | everything else — **`lastSeq === 0` (full) OR `lastSeq > 0` (delta)** | `getEvents(lastSeq + 1)` |
| `:346` | cold hydration after disk parse | full stream from seq 1 |

`:260` is **not** a delta-only path. `lastSeq = msg.lastSeq ?? 0`, so a browser reload with no cached seq against a still-warm server takes this branch with `getEvents(sessionId, 1)` — the entire stream. The existing comment at `:264` says so explicitly ("delta or full"). This is the primary scenario in issue #521, so any rule keyed on *call site* rather than *content* would leave the feature inert exactly where it is needed.

Inside `sendEventBatches`, `compactEventsForReplay` drops superseded `message_update` snapshots (~20:1 on a warm window), and `truncateToolResultForReplay` shrinks per-event payloads. The store keeps the full stream regardless.

### The client replay cache decides which path a reload takes

On reload the client calls `rehydrateSession` (`packages/client/src/lib/replay/rehydrate-session.ts`): a cache hit re-reduces the persisted payload and subscribes with `lastSeq = entry.maxSeq` (delta); a miss subscribes `lastSeq: 0` (full). So whether windowing fires on reload is decided by the IndexedDB cache, not by the server.

This lands favourably for the target population. `replay-cache.ts:228` **refuses to persist a payload over `DEFAULT_MAX_BYTES_PER_SESSION` (5 MB) and deletes any stale entry**:

| Session size | Cache | Subscribe | Windowed? |
|---|---|---|---|
| Large (> 5 MB payload — issue #521's case) | miss, always | `lastSeq: 0` → full stream | **yes** |
| Small/medium (≤ 5 MB) | hit | `lastSeq > 0` → delta | no — and cheap anyway |

The sessions that blow the cache cap are exactly the sessions this change targets, and they are structurally forced onto the full-stream path where the window applies. The two mechanisms are complementary rather than competing.

*Residual:* a session near but under the cap takes the delta path, and its reload cost stays the synchronous re-reduce of up to 5 MB inside `rehydrateSession`. That cost is client-local, never reaches the server, and is out of scope here — recorded as a Non-Goal.

Constraints that bound any change here:

- **D4 high-water mark** (`compact-warm-replay-stream`): `sendEventBatches` returns the max seq of the **full input array**, computed at `:83` BEFORE compaction. `clearReplaying` (`browser-gateway.ts:641`) feeds it to `getEvents(lastReplayedSeq + 1)` for catch-up. A lower return value re-sends delivered events.
- **Chat-head preservation** (`preserve-chat-head-on-event-trim`): the store trim drops from the middle, never the head. `maxEventsPerSession` default 20000.
- **Store API is forward-only**: `EventStore.getEvents(sessionId, minSeq)` is the sole range read (`memory-event-store.ts:16`). There is no upper-bounded or reverse query.
- **Reducer reset rule**: `shouldReset = firstSeq === 1 || firstSeq <= maxSeq` (`useSessionState.ts:69`).

## Goals / Non-Goals

**Goals:**
- Bound the events replayed to the browser on subscribe, by user configuration.
- Keep the chat head visible when the bound applies.
- Make the elided region reachable on demand, so bounding is non-destructive within what the store holds.
- Zero behavior change for users who do not opt in.

**Non-Goals:**
- **Bounding the disk parse.** Cold hydration still reads and stores the whole session file; only the wire + client replay is windowed. The first cold open keeps its parse cost.
- **Durable backfill.** Backfilled events live in client memory only. A reload or `session_state_reset` re-runs the windowed replay and the fetched middle is gone. Accepted (see Risks).
- Changing what the event store retains.
- Serving backfill from disk.
- Persisting scroll position across reloads.
- **Reducing the client-side re-reduce cost on a replay-cache HIT.** A cached session reloads by re-reducing its payload locally and delta-subscribing; the server never sees those events, so server-side windowing cannot help. Bounded by the cache's own 5 MB cap. A separate concern.

## Decisions

### D1 — Windowing is keyed on CONTENT (is this a full stream?), never on call site

`sendEventBatches` gains an optional trailing `windowLimit?: number`. The caller passes it only when the array it is handing over is a **full stream**:

```ts
const isFullStream = lastSeq === 0 || (lastSeq > 0 && lastSeq > maxSeq);
```

- `:242` (stale) — always full → pass.
- `:260` — pass **only when `lastSeq === 0`**. A genuine delta (`lastSeq > 0`) never windows.
- `:346` (cold hydration) — always full → pass.

*Why content and not site:* `:260` is dual-purpose. Excluding it by site (the earlier draft of this design) would have made `maxReplayEvents` a no-op for warm reloads — the dominant reopen path. Excluding a genuine delta remains mandatory: windowing a delta punches a seq gap between what the client holds and what it receives.

### D2 — Slice AFTER compaction; D4 holds because the high-water mark is read from the INPUT

The window is applied to `compacted`, not `stored`.

*Why:* compaction is ~20:1. Budget spent pre-compaction is mostly spent on snapshots discarded microseconds later; the same N post-compaction buys far more actual conversation.

*Why D4 survives:* `preCompactionMaxSeq` is computed at `:83` from the **full `stored` array**, before both compaction and windowing. It is emphatically **not** "the last event of the window" — compaction can drop the highest-seq event (a still-superseded `message_update`), and windowing can drop more. Any refactor that derives the return value from the windowed array returns a lower seq and makes `clearReplaying` re-send. This is pinned by a regression test asserting the return equals the full-input max even when the window elides the top.

### D3 — Head + tail split, with a floor, a minimum window, and a fits-entirely short-circuit

**Short-circuit first:** when `compacted.length <= windowLimit` the window does NOT apply — the full array is sent and `gapCount` is `0`. Only when the array genuinely exceeds the budget is it split:

```
head = clamp(floor(windowLimit * HEAD_RATIO), HEAD_MIN, HEAD_CAP)
tail = windowLimit - head
```

`HEAD_RATIO = 0.1`, `HEAD_MIN = 20`, `HEAD_CAP = 200`.

Config validation enforces `maxReplayEvents === 0 || maxReplayEvents >= MIN_WINDOW` with `MIN_WINDOW = 100`; out-of-range positive values clamp up to `MIN_WINDOW`.

*Why the short-circuit is load-bearing:* `MIN_WINDOW` is validated per-VALUE, not per-session, so a small session under any non-zero setting is always reachable (config `1000`, session of 40 events). Without the guard, `head(100) + tail(900)` exceeds the array, `slice(0, head)` and `slice(len - tail)` OVERLAP and emit duplicate events, and `gapCount = len - head - tail` goes negative. The short-circuit makes the overlap case unrepresentable rather than handled.

*Why the floor and the minimum:* a bare `min(HEAD_CAP, floor(limit * 0.1))` yields `head = 0` for any limit under 10, silently degrading to tail-only — the shape this decision exists to reject. `HEAD_MIN` plus `MIN_WINDOW` makes a head-free window unreachable by configuration.

### D4 — Both cut edges snap, and both snaps SHRINK the window

- The **tail's leading edge** snaps FORWARD to the next `message_start` / `turn_start`.
- The **head's trailing edge** snaps BACKWARD to end on a completed `message_end`.

Both bounded by `SNAP_LOOKUP = 200` events; if no boundary is found within the bound, the exact index is used.

*Why forward for the tail (not backward):* backward snapping ADDS events beyond the configured budget, making `maxReplayEvents` a soft floor — a user setting 500 could receive ~700. Forward snapping drops a few of the oldest tail events instead, so the budget stays a **hard** cap while still opening on a clean boundary. Strictly better on both axes.

*Why the head also snaps:* a head ending mid-message leaves a dangling `message_start` with no `message_end`, which can strand a permanently "streaming" row in the UI. Snapping backward to a completed message closes it, and also shrinks.

*Why still best-effort:* both snaps can fail to find a boundary within the lookup bound, so the reducer MUST tolerate orphans at either edge. Snapping raises quality; reducer tolerance is the correctness guarantee. Verified by explicit tests, not assumed — this repo already carries a `fix-reducer-crash-undefined-toolname` regression.

### D5 — The gap is in the MIDDLE; the protocol describes a gap, not a floor

With head + tail, the missing region is bounded on BOTH sides. A "load older / prepend" model is structurally wrong: `hasMore = oldestLoaded > oldestAvailable` reads **false** for a head-preserving window (the head sits at seq 1, so nothing is missing *below* it) while the real gap sits above the head.

Sent once per subscriber, immediately after `session_state_reset` / asset replay and before the first `event_replay`:

```ts
export interface SessionHistoryWindowMessage {
  type: "history_window";
  sessionId: string;
  headMaxSeq: number;   // last seq of the head segment; always >= 1
  tailMinSeq: number;   // first seq of the tail segment
  gapCount: number;     // events elided between them; 0 = no window applied
  oldestGapSeq: number; // lowest gap seq the store can still serve
}
```

Emitted on **full-stream paths only** — the same predicate that gates windowing (D1). A genuine delta (`lastSeq > 0` at `:260`) never emits it. On the cold-hydration path (`:346`) it is emitted per subscriber inside the existing loop.

*Why not "always":* a delta subscribe happens on every ws reconnect. Emitting a `gapCount: 0` window there would hand a client that is mid-gap-browsing a message that resets its gap bookkeeping, silently discarding an in-progress exploration on a transient reconnect. Scoping emission to the paths that actually build a window keeps delta reconnects inert.

**The head always starts at seq 1 and is never empty when a window applies** (D3's `HEAD_MIN` floor plus the short-circuit). This matters because the `lastSeq === 0` path at `:260` does NOT send `session_state_reset` — it relies solely on the reducer's `firstSeq === 1` rule. To remove that dependency on a store invariant, the server sends an explicit `session_state_reset` before a windowed replay on that path, so a tail-first delivery can never fold into stale transcript state even if the store's head were pathologically trimmed.

### D6 — Backfill requests an explicit RANGE and splices into the gap

```ts
export interface HistoryBackfillRequestMessage {
  type: "history_backfill";
  sessionId: string;
  fromSeq: number;  // inclusive
  toSeq: number;    // inclusive
}

export interface HistoryBackfillResultMessage {
  type: "history_backfill_result";
  sessionId: string;
  events: Array<{ seq: number; event: DashboardEvent }>;
  servedFrom: number;
  servedTo: number;
  remainingGapCount: number; // still-servable events in the gap; 0 = nothing more
  error?: "not_subscribed" | "in_flight" | "out_of_range" | "stale_generation";
}
```

**Client loop termination is keyed on the response, not on arithmetic:** stop requesting when `events.length === 0` OR `remainingGapCount === 0`, whatever the cause. This terminates correctly over a holey store without needing a distinct "hole" error code — a range landing in a pre-existing store hole simply returns zero events and a truthful `remainingGapCount`.

The client splices the response into the gap position — it does not prepend to the head of the transcript.

*Why a distinct response type:* the reducer treats `event_replay` as append-or-reset (`firstSeq === 1 || firstSeq <= maxSeq` → reset). Backfilled seqs are below the tail's `maxSeq` by construction, so routing them through `event_replay` would fire a full state reset on every scroll-up.

*Why an explicit range rather than `beforeSeq + limit`:* the client knows the gap bounds from `history_window` and can request a definite sub-range. A `beforeSeq` cursor cannot express "the slice adjacent to the head" versus "the slice adjacent to the tail", and it re-serves head events the client already holds when the store's trim has preserved the head.

**Every request receives exactly one response**, including the drop cases, which carry `error` and an empty `events`. A dropped request never leaves the client spinning with no retry path.

### D7 — Backfill responses are compacted against the FULL stream's supersession boundary

Both `truncateToolResultForReplay` and compaction apply — but compaction must NOT be run naively over the slice.

`compactEventsForReplay` drops every non-exempt `message_update` positioned before **the last `message_end` in the array it is given** (`replay-compaction.ts`, pass 1 → `lastMessageEndIdx`). That boundary is array-relative, so the function is **not window-invariant**:

- Run naively on a gap slice, the boundary is the slice's own trailing `message_end`. Updates after it survive — even though their `message_end` lives in the already-delivered tail. Stale cumulative snapshots re-enter and render over a closed message.
- **Skipped entirely, the outcome is strictly worse:** the store retains every cumulative snapshot, so an un-compacted slice serves ALL of them — maximal payload AND maximal staleness. Skipping does not avoid the failure it appears to avoid; it guarantees it.

`compactEventsForReplay` therefore takes an explicit supersession boundary instead of deriving one. For any gap slice a later `message_end` always exists outside the slice (in the tail), so the entire slice is superseded: every non-exempt update drops, and only the two documented exemptions survive — thinking updates, and the last text-bearing update before each `tool_execution_start`.

*Why this is both correct and maximally compacting:* it reproduces exactly what the initial replay would have emitted for that range had the range been part of the full window, which is the only definition of correct here.

### D8 — New store API: one upper-bounded read, resolved by binary search

`EventStore` gains `getEventsRange(sessionId, minSeq, maxSeq): StoredEvent[]`, implemented as a **binary search for both bounds over the seq-sorted buffer, then one slice** — O(log n + k), NOT a linear filter.

*Why the API:* the store exposes only forward `getEvents(sessionId, minSeq)` (`memory-event-store.ts:16`). Serving a bounded gap slice through it materializes every event from `minSeq` to the end and discards the tail.

*Why the implementation is part of the decision:* the existing `getEvents` is a linear scan. A `getEventsRange` written the same way is O(n) per backfill regardless of span, which is the exact per-scroll cost this change exists to remove — the new API would be pure ceremony. The buffer is seq-sorted and append-only, so binary search is available; specifying it here prevents a correct-but-pointless implementation.

### D9 — Server clamps every client-supplied bound; single-flight per socket+session

`toSeq - fromSeq` clamps to `BACKFILL_MAX_SPAN = 500`. The range clamps into the session's actual gap and the store's floor. A request for an unsubscribed session is refused with `error: "not_subscribed"`. At most ONE backfill in flight per (socket, session); a second is refused with `error: "in_flight"` rather than queued.

**Subscription-generation tag.** Each (socket, session) subscription carries a monotonic generation counter, incremented on every subscribe. When the generation at completion differs from the generation at request time, the server **replies with `error: "stale_generation"` and an empty `events`** — it does NOT silently drop the response.

*Why the reply rather than a drop:* silently dropping contradicts D6's "every request receives exactly one response" and strands a client that issued a backfill just before an unsubscribe/re-subscribe with a pending state and no retry path. The client additionally clears pending backfill state on `session_state_reset` and on re-subscribe, so the two mechanisms are belt-and-braces rather than co-dependent.

*Why not just splice it anyway:* a late response computed against the OLD window can carry seqs that overlap the new window's head or tail, producing duplicate rows.

*Why:* the span is attacker-controlled and is otherwise a request-amplification lever — one small frame forcing an arbitrarily large serialize + send. Single-flight stops scroll-spam from stacking work; the explicit `error` reply keeps it from stalling the client.

### D10 — Backfill touches `messages[]` and nothing else

It does NOT update `maxSeqMapRef` (backfilled seqs are below the current max by construction, so the live-event high-water mark must not move), does NOT publish to the plugin runtime via `publishSessionEvents` (a live-event fan-out; replaying historical events into it would double-count plugin state), and does NOT re-seed `replayPersister`.

*Why explicit:* these three consumers are fed from the same handler as `messages[]`. Silently inheriting the write would desync plugin cards and the durable replay buffer against the transcript.

### D11 — Backfill arms only after hydration completes

The client's scroll-up trigger stays disarmed until the initial replay has terminated (`isLast: true`).

*Why:* for an evicted cold session the store is empty until hydration finishes. A backfill issued during that window returns empty with `remainingGapCount: 0`, then hydration lands and the same session suddenly has a servable gap — availability would flap across hydration.

### D12 — A windowed replay is NOT written to the client replay cache

When a window applies, the client skips `replayPersister` seeding/recording for that session.

*Why this is mandatory, not an optimization:* windowed events arrive over the ordinary `event_replay` stream (`useMessageHandler.ts:755`), which unconditionally feeds the persister. A session whose windowed payload is under the 5 MB cap would therefore cache a SPARSE array as if it were contiguous. The next reload gets a cache HIT, re-reduces head+tail into a transcript where the two are silently adjacent, and delta-subscribes — and a delta never emits `history_window` (D5). The gap becomes permanently invisible and unrecoverable: no divider, no affordance, and the delta stream only ever extends the tail.

Skipping the write makes the next reload a cache MISS → `lastSeq: 0` → full stream → windowed again → `history_window` emitted → affordance restored. Self-healing, and it keeps "windowing state is never persisted" a simple invariant instead of a metadata-synchronization problem.

*Cost:* a windowed session forfeits the reload cache. Acceptable — the user opted into windowing precisely because full replay of that session is too expensive, and the windowed replay is by construction the cheap one to repeat.

### D13 — Default `0`, gated on proven reducer tolerance

`memoryLimits.maxReplayEvents` defaults to `0` (unlimited), surfaced in Settings → Memory Limits with the existing "requires server restart" affordance.

*Why:* a non-zero default silently truncates history for every existing user on upgrade and lands the orphan-edge risk (D4) across the whole install base unproven.

## Risks / Trade-offs

- **[Reducer mishandles an orphan at either window edge]** → D4 snaps both edges; explicit L1 tests drive orphan shapes through the reducer; default `0` holds the blast radius at zero until proven.
- **[Backfilled content is lost on reload or `session_state_reset`]** → accepted trade-off, now an explicit Non-Goal. Making it durable means persisting a sparse transcript and reconciling it against a later replay — disproportionate for a scroll-back convenience. The user re-scrolls; the data is never destroyed server-side.
- **[Gap is partially unservable: the store's middle trim already dropped part of it]** → for a session over `maxEventsPerSession` the stored array is itself non-contiguous, so `tailMinSeq - headMaxSeq - 1` (seq distance) OVERSTATES what exists. `gapCount` is therefore defined as the count of gap events the store actually holds — never the seq distance — so a "N earlier events" divider cannot promise rows that were trimmed months ago. `remainingGapCount` reports the same quantity as the client consumes it.
- **[`HEAD_MIN` is a pre-snap floor]** → D4's backward head snap can shrink the head below `HEAD_MIN` when the first `message_end` sits very early. Non-emptiness still holds via the snap fallback, so this is a cosmetic degradation of the "head preserved" intent rather than a correctness issue. Noted, accepted.
- **[Splice triggers scroll jump]** → capture `scrollHeight` before splice, restore delta after paint; must compose with `chat-scroll-lock`, not fight it.
- **[Backfill loop: splice re-triggers the gap sentinel]** → eliminated by the click-to-load divider; a splice cannot trigger a further request without another explicit click. Single-flight (D9) remains as a defence against double-clicks.
- **[Cold-open latency barely improves because the disk parse dominates]** → acknowledged Non-Goal. The change is therefore held to a **deterministic server-side observable — delivered event count and serialized wire bytes on subscribe — not a wall-clock latency threshold.** Wall-clock is dominated by the un-windowed disk parse and by client hardware, so asserting it would be measuring someone else's cost.
- **[Benchmarking against a cache-warm browser shows no improvement and the feature looks broken]** → a cached session delta-subscribes and is never windowed by design. Any perf measurement MUST state its cache state; the honest comparison is a cache-miss open (which is what a >5 MB session always gets).
- **[Protocol surface grows by three messages]** → all additive; an older client never sends `history_backfill` and ignores `history_window`.

## Migration Plan

Additive throughout. `parseMemoryLimits` defaults `maxReplayEvents` to `0` when absent, so existing `config.json` files load and behave identically. Rollback = set back to `0`. No data migration, no persisted state to unwind.

## Residuals found by the independent review (implementation phase)

Recorded rather than silently fixed: each is a challenge to a DOCUMENTED decision,
not an implementation defect, and the feature ships default-`0` so the blast
radius is opt-in only. Fixed during the review loop: a stale scroll anchor left
armed by a backfill that spliced nothing (`ChatView.tsx`).

- **[The far side of the gap is unreachable over a middle-trimmed store]** — the
  store trims from the MIDDLE, so a session past `maxEventsPerSession` holds
  `[1..K] ∪ [L..end]`. The client fills HEAD-ward (`nextBackfillRange` starts at
  `headMaxSeq + 1`) and D6's stop rule fires on the first `events.length === 0`,
  which is the hole — so the still-servable block adjacent to the tail can never
  be fetched, even though `remainingGapCount` truthfully reports it. D6 specifies
  exactly this rule, so the code is correct against the design; the DESIGN
  conflates "hit a hole" with "nothing left". Resolve before any non-zero default
  ships. `oldestGapSeq` (D5) is currently carried on the wire and stored but
  never read — it is precisely the seed a hole-skipping fill would use.
- **[The D7 exemption is computed per 500-event chunk, not per stream]** — when a
  `BACKFILL_MAX_SPAN` boundary splits a text-bearing `message_update` from the
  `tool_execution_start` it seeds, the update is dropped, where full-stream
  compaction would have kept it. So D7's "reproduces exactly what the initial
  replay would have emitted" holds within a chunk, not across one. ~1/500 per
  tool call, backfilled history only.
- **[`remainingGapCount` materializes the remaining gap to count it]** —
  `getEventsRange(...).length` is O(k) per request where the binary search
  already has both bound indices and `end - start` would be O(log n). Bounded by
  the store cap and paid once per user click, but it does cut against the D8
  rationale that motivated the API.
- **[Settings does not clamp to `MIN_REPLAY_WINDOW` at the point of entry]** — a
  user typing `99` saves `99` and `parseMemoryLimits` silently loads it as `100`.
  Cosmetic; the hint copy is fixed by `mockups/ui-plan.md` § B and was not
  changed to describe the floor.

## Open Questions

- `HEAD_RATIO` / `HEAD_MIN` / `HEAD_CAP` (D3), `SNAP_LOOKUP` (D4) and `BACKFILL_MAX_SPAN` (D9) are proposed, not measured. Confirm against a real large session before they harden.
- ~~Divider vs auto-fetch on scroll proximity?~~ **RESOLVED: explicit "N earlier events" divider with a click-to-load button.** The trigger is a discrete user action, which removes the backfill-loop risk entirely and makes the behaviour deterministic to test. Trades a little of the issue's "gradually load as you scroll" feel for predictability.
- ~~What counts as a "settled scroll position" before re-arming?~~ **RESOLVED: moot.** Click-to-load has no re-arm condition; single-flight (D9) remains as the only concurrency guard.
- `getEventsRange` (D8) could subsume `getEvents(sessionId, minSeq)` as `getEventsRange(id, min, Infinity)`. Worth collapsing, or keep both to avoid touching every existing call site?
