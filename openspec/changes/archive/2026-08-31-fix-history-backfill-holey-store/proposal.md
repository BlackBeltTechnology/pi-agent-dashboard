## Why

On a **holey** event store (retention trims the middle, seqs survive but events do not) the "Load earlier" affordance is broken two ways. The client mislabels a legitimately-empty seq window as gap exhaustion and shows the dead-end "These earlier messages are no longer available to load." — even though `remainingGapCount` is still positive. And the backfill walk is bounded by **seq distance** (500 seqs/step), not event count, so closing a 92-event gap that spans ~102 000 seqs takes ~205 requests instead of one. In `head-tail` mode (the default) that walk is click-to-load, so the user would have to click ~205 times; observed live on a real session where one click produced "no longer available."

## What Changes

- **Client termination rule** — stop the backfill walk on `remainingGapCount === 0` only. An empty `events` array with a positive `remainingGapCount` is a sparse-window miss, not exhaustion: keep the affordance armed and let the walk continue. This removes the false "no longer available" (`unservable`) state in `head-tail` and the premature `atFloor` terminus in `head-free`.
- **Count-bounded serve** — the backfill span cap becomes a maximum number of **events**, not a seq distance. The server serves up to N events nearest the abutting edge within the requested range, so one response closes a holey gap regardless of how wide its seq span is. Aligns the implementation with the existing spec wording ("more events than the maximum span").
- **Full-remaining-range request** — the client requests `[floor, tailMinSeq − 1]` (floor = `headMaxSeq + 1`, or `oldestGapSeq` in a head-free window) each step, letting the server's count cap pick the newest N events from anywhere in the sparse gap rather than only the top 500 seqs (which may hold nothing).
- **Bounded store read** — a count-bounded range read on the event store so serving the newest N events below a seq stays O(log n + N), never a full-gap materialization on a dense session.
- No wire-format change: `history_backfill` / `history_backfill_result` shapes are unchanged; only the server's within-range selection semantics and the client's termination + request-range derivation change. An older client that still sends a narrow `[tail−500, tail−1]` window keeps working against the new server (no new breakage), but does NOT gain the fix — it still false-marks a sparse window as unservable. The correctness fix is client-side, so a client upgrade is required to actually resolve the symptom; the two ends are independently deployable.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-history-backfill`: the exhaustion rule keys on `remainingGapCount` only (an empty response with remaining gap does not terminate and is not `unservable`); the span cap is a maximum event **count** rather than a seq distance; the client requests the full remaining range each step and the tail edge retreats on every response; the head-free floor terminus fires only when `remainingGapCount` reaches `0`.

## Impact

- **Client**: `packages/client/src/lib/chat/history-gap.ts` (`nextBackfillRange`, `BACKFILL_MAX_SPAN` semantics), `packages/client/src/hooks/useMessageHandler.ts` (`history_backfill_result` exhaustion branch — drop `events.length === 0` from the `exhausted` predicate; head-free `atFloor` keyed on `remainingGapCount`).
- **Server**: `packages/server/src/browser-handlers/subscription-handler.ts` (`handleHistoryBackfill` span clamp → count clamp; serve newest-N-events selection).
- **Store**: `packages/server/src/persistence/memory-event-store.ts` (add a count-bounded range read + its sub-linearity probe, sibling to `getEventsRange` / `getRangeProbe`).
- **Spec**: `openspec/specs/session-history-backfill/spec.md` delta.
- No persistence-format, config, or protocol-shape change; no migration.

## Discipline Skills

- `performance-optimization` — the count-bounded store read has a large-data path (a dense gap must not be fully materialized to serve N events); the O(log n + N) bound is a measured budget, guarded by a probe.
- `systematic-debugging` — used to root-cause the live symptom (empty seq-window ≠ exhaustion); the fix is verified against the same holey-store reproduction.
- `review-code` — non-trivial change to a wire-adjacent contract; run before commit.
- Not triggered: `security-hardening` (no new untrusted input — seq bounds are already validated and clamped; serving is already subscription-gated), `observability-instrumentation` (no new endpoint/job/external call).
