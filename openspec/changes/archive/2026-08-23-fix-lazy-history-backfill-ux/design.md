## Context

`lazy-load-session-history` established the shape this change repairs, so the existing seams matter more than the new code:

- **Server.** `computeReplayWindow` (`subscription-handler.ts:154`) splits a compacted stream into a head (`min(HEAD_CAP=200, max(HEAD_MIN=20, floor(limit * 0.1)))`) and a tail, snapping the head's trailing edge back to a `message_end` and the tail's leading edge forward to a `message_start`/`turn_start`, each within `SNAP_LOOKUP = 200` — **best-effort**, and this contingency is load-bearing below. It announces `history_window { headMaxSeq, tailMinSeq, gapCount, oldestGapSeq }`.
- **Per-(socket, session) `GapState`** holds `headMaxSeq` (advances), `tailMinSeq` (documented as *"fixed for the life of the subscription"*), `generation`, and an `inFlight` single-flight latch.
- **`handleHistoryBackfill`** clamps `from` up to `headMaxSeq + 1`, `to` down to `tailMinSeq - 1`, then clamps the span to `BACKFILL_MAX_SPAN = 500`. It advances `headMaxSeq` **only** when `from === headMaxSeq + 1`. `remainingGapCount` is a *truthful* store read — `getEventsRange(headMaxSeq + 1, tailMinSeq - 1).length`, never seq arithmetic, because the store can be holey.
- **Client splice.** `useMessageHandler`'s `history_backfill_result` case reduces the slice from a **fresh** `createInitialState()` and merges **`messages` only** — `next.set(sessionId, { ...current, messages })` (`useMessageHandler.ts:796`). `seg.toolCalls` is **discarded**. This single fact drives D3/D5 and was the source of three defects in the first draft of this design.
- **Rendering + reconcile read different places.** Renderers read the *row*: `status={msg.toolStatus ?? "running"}` (`ChatView.tsx:1232`), whose union is `"running" | "complete" | "error"` (`event-reducer.ts:55`). `useStaleToolReconcile` scans `state.toolCalls`. A spliced row therefore appears in neither the tool-call map nor the reconcile's universe.
- **Scroll.** `captureScrollAnchor` / `restoreScrollAnchor` preserve *distance from scroll position to the bottom of content* — correct **only** for insertions strictly above the scroll position, as their own docstring states. `ChatView` arms `gapAnchorRef` on click, consumes it in the `historySpliceRev` layout effect, and disarms it on the pending→settled edge (`ChatView.tsx:433`).
- **Config defaulting happens in four places**, not one: `parseMaxReplayEvents` (`config.ts:838`, which maps absent, negative, non-numeric, and explicit `0` all to `0`), `DEFAULT_MEMORY_LIMITS`, `SettingsPanel`'s display `?? 0` and its `MEMORY_LIMITS_SEED`, and the server's `ctx.maxReplayEvents ?? 0` (`subscription-handler.ts:529`).

Three properties are load-bearing and must survive: exactly one response per request, a truthful `remainingGapCount` over a holey store, and generation-checked staleness. The direction of travel is not load-bearing — it is an artifact of only one edge being mutable.

Field evidence from #521: with `maxEventsPerSession = 0`, `maxReplayEvents = 100`, "Load earlier" delivered the session head, scroll landed at an arbitrary offset, and a tool spinner stuck on roughly 6 of 10 loads.

## Goals / Non-Goals

**Goals:**

- "Load earlier" delivers the events *immediately preceding what the user is reading*, converging on the head.
- A backfill splice leaves the viewport visually fixed.
- A tool call whose completion is not loadable renders a truthful terminal state immediately.
- Windowing is on by default without silently destroying recoverable history.

**Non-Goals:**

- Serving backfill from disk. Unchanged Non-Goal: backfill reads the in-memory store only.
- Changing `history_backfill` / `history_backfill_result` field names or adding a message type.
- Bidirectional or multi-gap windows. Exactly one gap, bounded on both sides, per subscription.
- Reworking `compactEventsForReplay` or `truncateToolResultForReplay`.
- Merging `seg.toolCalls` into session state on splice (see D5 — deliberately avoided, not overlooked).
- Making `useStaleToolReconcile` faster.

## Decisions

### D1 — Make the gap symmetric: `tailMinSeq` retreats, `headMaxSeq` still advances

`GapState.tailMinSeq` stops being fixed. A served range is credited to whichever edge it abuts:

- `from === headMaxSeq + 1` → `headMaxSeq = to`
- `to === tailMinSeq - 1` → `tailMinSeq = from`
- neither → serve the events, credit nothing

`remainingGapCount` remains a store read over `(headMaxSeq, tailMinSeq)`, already correct under a two-sided gap.

*Alternative — client keeps requesting head-first, UI reverses the presentation.* Rejected: the events still arrive oldest-first, so the user waits through the whole gap. The complaint is about *what arrives*.

*Alternative — replace both edges with `gapRanges: [lo, hi][]`.* Rejected as over-general; invites the multi-gap state machine listed as a Non-Goal.

*Keeping the head edge mutable* is what preserves back-compat for an older cached client (see Risks).

### D1a — A both-adjacent final request credits the tail

The final short request can satisfy both adjacency tests at once. The crediting branch is exclusive (`else if`), so the order is a real decision, not an implementation detail: **credit the tail**, keeping one consistent direction of travel. Either choice yields `remainingGapCount === 0` and the client's A6 path, so this is about a coherent spec, not correctness.

### D2 — The client walks down from the tail

```ts
export function nextBackfillRange(gap: HistoryGapState): { fromSeq: number; toSeq: number } {
  const toSeq = gap.tailMinSeq - 1;
  return { fromSeq: Math.max(gap.headMaxSeq + 1, toSeq - BACKFILL_MAX_SPAN + 1), toSeq };
}
```

`HistoryGapState.tailMinSeq` loses its "fixed for the life of the subscription" contract and is updated from `servedFrom`. The `headMaxSeq = servedTo` update is dropped from the client's result handler — moving both edges from one response double-shrinks a gap the server credited once.

### D3 — Splice below the divider; the tool-call map is still not merged

Tail-anchored events are the *newest* remaining gap events, so they belong immediately above the tail — insertion moves from `at` to `at + 1`.

The splice keeps merging **`messages` only**. This is deliberate: `seg` is reduced from a fresh state, so its `toolCalls`, `stats`, and counters describe a fragment, and merging them would corrupt session-level state. The consequence — a spliced tool row exists only as a row, never in `state.toolCalls` — is what forces D5 to operate at the row level. The existing guarantees are unchanged: no `maxSeqMapRef` move, no `publishSessionEvents`, no `replayPersister` write.

### D4 — Snap the gap-facing edge of every slice, to set up the NEXT slice's seam

Extract the snap loops from `computeReplayWindow` into a shared helper and apply it to the **gap-facing** edge of a backfill slice — the lower edge for a tail-anchored request, the upper edge for a head-anchored one. Defining it by orientation rather than hardcoding "trailing edge" is what keeps a legacy head-first client correct.

**Why snapping the lower edge helps is not what the first draft claimed.** Within a tail-anchored slice `[F, T]`, a dangling `tool_execution_start` necessarily has its end at a seq **above** `T` — an end below `F` is impossible, since an end always follows its start. So the lower edge can only ever produce orphan *ends*, never orphan *starts*. The real value of snapping the lower edge is that slice `k+1`'s upper edge is exactly slice `k`'s lower edge minus one: a clean lower cut today makes the *next* slice's top seam clean. Consecutive slices therefore align, and only the **first** slice's upper edge is inherited rather than produced — it is `tailMinSeq - 1`, clean only if the initial window's tail snap found a boundary within `SNAP_LOOKUP`.

Snapping must only ever *shrink* the range, never exceed `BACKFILL_MAX_SPAN`, and never cross the gap bound. No boundary within `SNAP_LOOKUP` → serve the raw cut. If the snap would empty the slice, serve the unsnapped range: an empty `events` array is the client's *termination* signal, so an over-eager snap would silently strand the gap.

Credit the edge **after** snapping, from the actually-served bounds.

*Alternative — snap on the client after reducing.* Rejected: the client cannot know whether the partner is in the gap or was never recorded, and it has already paid the wire cost.

### D4a — Clamp the span by moving the NON-abutting bound

`handleHistoryBackfill` currently clamps an oversized span with `to = from + BACKFILL_MAX_SPAN - 1` (`subscription-handler.ts:463`) — it lowers `to`. For a tail-adjacent request that **destroys the very adjacency the response must be credited for**: `to` is no longer `tailMinSeq - 1`, so D1 credits nothing, while the client retreats its own `tailMinSeq` from `servedFrom`. The two views diverge, and the next request derives an inverted range that the server refuses as `out_of_range` — a failure loop, not the self-correction the Risks section claims for bookkeeping slips.

The clamp must therefore move the bound that is **not** abutting: raise `from` for a tail-adjacent request, lower `to` for a head-adjacent one. This also makes the duplicated `BACKFILL_MAX_SPAN` constant (`history-gap.ts:87` and `subscription-handler.ts:66`, independently maintained at `500`) harmless: under the corrected clamp, constant drift shortens a slice instead of silently breaking crediting. Deduplicating the constant is desirable but is no longer load-bearing.

### D5 — `elided` is a ROW-level status, stamped at the segment seam

The first draft put `elided` on `ToolCallState`. That is unobservable: the splice discards `seg.toolCalls` (D3), renderers read `msg.toolStatus`, and the reconcile scans `state.toolCalls`. A status set there would satisfy none of its own spec scenarios.

Therefore:

1. Widen the **row** union `ChatMessage.toolStatus` to include `"elided"`, and widen `ToolCall.status` to match so a single-pass reducer state stays coherent.
2. After a **backfill** segment is reduced, stamp **every** row still `running` as `elided`, before the rows are merged.
3. Renderers show a neutral "result not loaded" affordance — no spinner, no error styling.
4. Finalize any assistant row left `isStreaming` by the same segment. This is the identical defect one type over: a slice whose top edge lands mid-message produces a row with `isStreaming: true` (`event-reducer.ts:1252`) that nothing ever clears (`:1284`), i.e. a permanently "streaming" bubble — the exact failure the head-snap rationale was written to avoid. The stamp pass already walks the segment's rows, so closing it here costs nothing and leaving it open would ship a spinner-shaped bug adjacent to the one being fixed.

**Stamp all of them, not "the ones at a seam".** The first revision scoped this to the gap-facing seam, which is exactly where such a row can never be: a dangling start's end is always *above* the slice (D4), i.e. in already-delivered content, and later slices are strictly lower. So every still-running row in a completed backfill segment is provably unjoinable, and the simple rule is both correct and the only one that fires at all. A seam-scoped rule would have shipped the bug intact.

**Scope to backfill segments, not to the initial windowed replay.** A live session reopened mid-tool-run has a dangling `tool_execution_start` at the tail's trailing edge whose end simply has not happened yet — stamping that would label a genuinely running tool "not loaded", and would additionally remove it from supersede-heal eligibility (the heal selects `status === "running"`). The initial replay's own head seam can also carry an orphan when its snap fails; those stay on the existing reconcile path. This change does not claim to fix them.

**The renderer audit is wider than the first revision stated**, and two entries are not optional:

| Site | Failure if missed |
|---|---|
| `ToolCallStep.tsx:42` prop union `"running" \| "complete" \| "error"` | **compile error** — `ChatView.tsx:1232` feeds the widened row union straight into it |
| `AgentToolRenderer.tsx:66` — `toolStatus === "error" ? … : toolStatus === "complete" ? … : "running"` | elided **renders a spinner**; and subagent rows are the likeliest to be windowed (D7) |
| `ChatView.tsx:1232` `?? "running"` | unstamped row spins |
| `ToolBurstGroup.tsx:296`, `CollapsedToolGroup.tsx:72` `?? "complete"` | silently reads as succeeded |
| `ToolBurstGroup.tsx:186` `doneCount` | elided counted as done in the burst header |
| `group-tool-calls.ts:79,101` | elided is not `running`, so it is absorbed into a collapsed ≥3 group where the affordance never renders |

Value-defaults and ternary fall-throughs are invisible to exhaustiveness checking. Grep, do not trust the compiler.

*Alternative — fetch the missing result at splice time* via `GET /api/sessions/:id/tool-result/:toolCallId`. Rejected here: per-row network work proportional to splice size, on the path the feature exists to make cheap. Available later as an opt-in expansion of the affordance.

### D6 — Preserve `scrollTop`; delete the distance-to-bottom anchor for this path

The first draft proposed a bounded settle loop over `restoreScrollAnchor`. That is **wrong-signed** under D3 and would guarantee the jump it was meant to prevent.

`captureScrollAnchor` preserves `scrollHeight - scrollTop`, which holds the viewport steady only for insertions **above** the scroll position — today's head-first geometry. D3 inserts *below* the divider, and the divider is by definition inside the viewport (the user just clicked it). Nothing above the reading position changes, so the correct invariant is simply **absolute `scrollTop`**, and it needs *no* correction: a virtualizer positioning from the top cannot shift in-view rows by measuring rows below them. Applying distance-to-bottom would instead set `scrollTop += H` for the full inserted height (up to 500 rows), scrolling the divider out of view on every splice — an exact jump, not drift.

So this decision **removes** code rather than adding it: drop the capture/restore, the `historySpliceRev` layout effect, and the `gapAnchorRef` disarm effect (`ChatView.tsx:433`) that exists solely to unstick that anchor. `captureScrollAnchor`/`restoreScrollAnchor` have no other call site, so they go too, and the `historySpliceRev` prop threaded from `App.tsx` becomes dead and must be removed with them.

**"Leave `scrollTop` alone" is not the same as "nothing writes `scrollTop`".** Deleting the layout effect removes the only splice-time hook, so two existing writers must be given an explicit owner rather than inherited by accident:

1. **The virtualizer grow-pin** — `ChatView.tsx:784`: `if (grew && stickToBottomRef.current && !isSelectingRef.current) el.scrollTop = el.scrollHeight`. A splice grows the content, so any user inside the 50px near-bottom band (`SCROLL_THRESHOLD`) gets yanked to the bottom. Disarming at click is not sufficient — `handleScroll` (`ChatView.tsx:861`) can re-arm mid-flight.
2. **The selection-anchor compensator** — `ChatView.tsx:1003-1051` (`anchor-chat-selection-against-row-growth`) writes `scrollTop` on **every** commit while a selection is held. A splice above a held selection displaces the anchor row and triggers a correction, which would directly violate this change's own "no correction on total-height change" requirement.

Both must be explicitly suppressed for the splice commit. This is the part of D6 that is real work; the anchor deletion is the easy half.

*Corollary:* the "capture at click, apply after a network round trip" staleness problem disappears with the anchor. Live events arriving mid-flight would have invalidated a captured `scrollHeight`; nothing is captured now.

*Honest bound:* this holds the **divider** still, which is what the user is looking at. Content *below* the insertion point still shifts down by the spliced height — unavoidable, since that is where the new content goes.

*Alternative — `overflow-anchor: auto`.* Still rejected: not applied to programmatic virtualizer size changes, unsupported in Safari.

### D7 — Default `maxReplayEvents` to `2000`, and fix all four defaulting sites

`0` means nobody gets the feature without reading the issue thread. The flip is **not** a one-line constant change:

1. **`parseMaxReplayEvents` cannot distinguish absent from explicit `0`** — `raw <= 0 || !Number.isFinite(raw)` collapses absent, negative, non-numeric, and `0` into `0` (`config.ts:838`). The spec requires absent/negative/non-numeric → default, explicit `0` → `0` (the documented rollback lever). This needs presence detection, not a changed constant. Note the `MIN_REPLAY_WINDOW` clamp already exists and is **not** part of this change.
2. **`computeConfigPartial` writes `memoryLimits` as a whole object** — `partial.memoryLimits = config.memoryLimits` (`SettingsPanel.tsx:287`). Because `GET /api/config` returns the *parsed* config, `maxReplayEvents` is always materialized client-side, so editing any sibling field serializes an **explicit `2000`** the user never chose — converting a defaulted field into a pinned one behind their back. This is the real pin mechanism; the `?? 0` display default and `MEMORY_LIMITS_SEED` are dead code on this path and were misidentified as the hazard in the previous revision.
3. **`ctx.maxReplayEvents ?? 0`** on the server (`subscription-handler.ts:529`) — embedded/programmatic servers keep unlimited unless threaded.
4. **Negative values change meaning** — `-1` parses to `0` (unlimited) today and to the default after the flip. Small, but it is a behavioural change to an input some operator may be relying on as "off".

Choosing `2000`: `computeReplayWindow` early-returns when `compacted.length <= windowLimit`, so any session compacting below `2000` takes today's exact code path. Geometry at `2000`: head `200` (at `HEAD_CAP`, so the protected chat head is maximal), tail `1800`.

*Honest bound on that rationale:* `compactEventsForReplay` drops only superseded `message_update`s — tool, subagent, and flow events pass through. The ~20:1 ratio therefore does **not** generalize; subagent-heavy sessions (the workload that forced `maxEventsPerSession` to 20000) compact poorly and *will* window at `2000`. Windowing them is the intent, but the "essentially every ordinary session is unaffected" claim only holds for text-heavy sessions. This is why the value is gated on measurement, not argument.

### D8 — Explain the unservable gap at runtime; do not add a static settings predicate

The first draft proposed warning when `maxReplayEvents > 0` and `maxEventsPerSession` is "too small to back the gap". That condition is both **backwards and undecidable**:

- If `0 < maxEventsPerSession <= maxReplayEvents`, then `compacted.length <= stored <= maxEventsPerSession <= windowLimit`, and `computeReplayWindow` early-returns. **No window forms, so no gap exists** — the warned-about pairing is inert, not harmful.
- The genuinely harmful case is `maxEventsPerSession > maxReplayEvents` *and* a session that outgrows the cap so retention trims gap events. That depends on session size, which is unknowable at settings time. No config-only predicate can decide it.

Replace it with the two things that are actually decidable:

1. **Runtime explanation.** The divider already has an `unservable` state, correctly rendered as "not an error". Make it *explain* instead of merely stating. The wording must stay true for **both** causes of an empty slice: retention having trimmed the events, and `compactEventsForReplay` having dropped a whole all-`message_update` band as superseded (`replay-compaction.ts` — a gap slice always has its `message_end` outside it, so a slice spanning one long streamed message can compact to nothing while the store still holds every event). The client cannot distinguish these, so "these earlier events are no longer available to load" is honest where "dropped by retention" would sometimes be false.
2. **Unconditional help text** on the Memory Limits section documenting the interaction, rather than a conditional warning that would fire on the inert pairing and stay silent on the real one.

*Alternative — clamp or auto-raise `maxEventsPerSession`.* Rejected regardless: retention is a deliberate operator lever, and silently overriding it to serve a UI affordance inverts operator intent.

## Risks / Trade-offs

- **A stale client (older bundle, cached SW) still requests head-first** → D1 keeps the head edge creditable, so an old client behaves as today. D4 defines the snap edge by orientation so its slices snap correctly too.
- **A new client against an old server degrades to a dead button, not a cosmetic wrinkle.** An old server credits only head-adjacent ranges, so every tail-walk request except the last credits nothing and `remainingGapCount` never shrinks. The final `[headMaxSeq+1, headMaxSeq+1]` request does credit, but `remainingGapCount` is then computed over the already-delivered span and is still non-zero, so the client's A6 exhaustion path never runs; the next derived range inverts and `App.tsx:851` swallows it. The user sees a stale count and a button that does nothing. This is only reachable on a version skew (stale service-worker bundle against a restarted server) and resolves on bundle update — but it is a real degraded state and is recorded as such rather than waved through.
- **Both edges credited from one response** → crediting is structurally exclusive and `remainingGapCount` is a store read, so a bookkeeping slip self-corrects rather than compounding. D1a fixes the ordering.
- **A row misses the `elided` stamp** → renders as `running` via `?? "running"`, reproducing the original bug. Not compiler-detectable; requires a hand audit of every `toolStatus`/`status` value-default and comparison (`ChatView.tsx:1232`, `ToolBurstGroup.tsx:296`, `CollapsedToolGroup.tsx:72`).
- **The stamp over-reaches to a live tail** → labels a running tool "not loaded" *and* removes it from supersede-heal eligibility. Scoped to **backfill segments only**, never the initial windowed replay; needs an explicit regression test on a live mid-tool-run session.
- **An orphan is mislabelled `elided` while the client already holds its partner** in the delivered tail (possible when the initial tail snap found no boundary, so the first slice's inherited top edge is mid-turn). Accepted: strictly better than an infinite spinner, and rarer than today's raw cut. Not claimed as fixed.
- **A tool pair split across two slices can never rejoin** — each slice is reduced from a fresh state and only rows merge. This is why D4 snaps the gap-facing edge; where the snap fails, D5 is the floor.
- **`2000` is wrong for subagent-heavy workloads** → gated on task 1.2's measurement; `0` remains the exact rollback.
- **Widening a status union** → exhaustiveness catches `switch`, not `if (x === "running")` or `?? "complete"`. Grep, don't trust the compiler.

## Migration Plan

No data migration; no persisted format changes.

1. Land D1 + D1a + D2 + D3 together — server crediting and client direction are only meaningful as a pair, though each half is independently back-compatible.
2. Land D4, then D5. D5 must not wait on D4: it is the correctness floor.
3. Land D6. The anchor deletion is safe in isolation, but the two suppressed `scrollTop` writers are the substantive half and must land with it — removing the layout effect alone leaves the grow-pin free to yank the view.
4. Land D7 + D8 last, so the default flip ships only once the affordance is correct.

**Rollback:** set `memoryLimits.maxReplayEvents = 0` to restore the pre-`lazy-load-session-history` replay path exactly. Every other change is inert when no window is applied.

## Open Questions

- **Is `2000` the right default?** Requires the task 1.2 measurement, especially against a subagent-heavy session where compaction underperforms.
- **Should the `elided` affordance offer a per-row "load this result"** via the existing `tool-result` endpoint? Deferred (D5), but it changes the renderer's shape if adopted later.
- ~~Does `oldestGapSeq` still mean anything?~~ **Resolved:** it is written into `HistoryGapState` (`history-gap.ts:67`) and never read anywhere in the client. It is already vestigial, independent of this change. Task 1.3 decides drop-vs-keep as cleanup, not as a blocker.
