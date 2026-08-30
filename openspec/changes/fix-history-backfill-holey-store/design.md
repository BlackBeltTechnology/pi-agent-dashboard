## Context

See proposal.md — Why. The live symptom: a `head-tail` window with `headMaxSeq=58220`, `tailMinSeq=160334`, `gapCount=92`, `oldestGapSeq=58224` — a 92-event gap spread across ~102 000 seqs because retention (`preserve-chat-head-on-event-trim`) drops non-essential events while their seqs survive. Today the walk is bounded by seq distance (`BACKFILL_MAX_SPAN = 500` seqs, in both `packages/client/src/lib/chat/history-gap.ts` and `packages/server/src/browser-handlers/subscription-handler.ts`), so it needs ~205 requests, and `useMessageHandler.ts` flips the gap to `unservable` on the first empty slice (`exhausted = msg.events.length === 0 || …`).

The store (`memory-event-store.ts`) already resolves a range by binary-searching both bounds over the seq-sorted buffer (`getEventsRange`, O(log n + k)), with a `getRangeProbe()` asserting sub-linearity.

## Goals / Non-Goals

**Goals**
- One backfill response closes a gap whose events number ≤ cap, regardless of seq span.
- No false `unservable` / premature `atFloor` on a holey store.
- Serving one response stays O(log n + cap + snap-lookup) — never materialize the whole gap on a dense session.

**Non-Goals**
- No change to the `history_backfill` / `history_backfill_result` wire shapes, to `history_window`, or to the replay-window geometry (`computeReplayWindow`, head/tail ratio).
- No auto-load in `head-tail` (two-sided gaps stay click-to-load by design — `add-tail-only-replay-window` D7).
- No retention/persistence/config change; the gap's *existence* is unchanged, only how fast and how truthfully it fills.

## Decisions

### D1 — The cap is an event COUNT, not a seq distance

`BACKFILL_MAX_SPAN` (500) is reinterpreted from "max seqs per response" to "max events per response" (`MAX_BACKFILL_EVENTS`). On a contiguous store the two coincide; on a holey store the seq-distance cap is the bug — it caps *how far* a request reaches, not *how much* it delivers, so a wide-but-sparse gap yields near-empty responses. Alternatives rejected: (a) raising the seq cap — unbounded, a gap can span any distance; (b) client-side seq stepping tuned to observed density — the client cannot see store density and it flaps as retention runs.

### D2 — The client requests the full remaining range each step

`nextBackfillRange` returns `{ fromSeq: floor, toSeq: tailMinSeq - 1 }` where `floor = headMaxSeq + 1` (head-tail) or `oldestGapSeq` (head-free) — no `- BACKFILL_MAX_SPAN` subtraction. The server's count cap, not the client's seq window, decides how much comes back, so the newest N events are selected from *anywhere* in the sparse gap rather than only the top 500 seqs (which frequently hold nothing). The tail edge retreats to `servedFrom` on each response, so successive requests still converge on the head; the walk terminates on `remainingGapCount === 0`.

### D3 — A count-bounded store read (`getEventsEndingAt`)

Add `getEventsEndingAt(sessionId, minSeq, maxSeq, limit)` → the highest-seq stored events in `[minSeq, maxSeq]`, at most `limit`, ascending. Parameter order follows the store's `(sessionId, minSeq, maxSeq, …)` convention (matching `getEventsRange` / `countEventsRange`), and the read touches `buf.lastAccess` like every other read (LRU). Implementation mirrors `getEventsRange`: binary-search `end = lowerBound(maxSeq + 1)` and `startFloor = lowerBound(minSeq)`, then `slice(Math.max(startFloor, end - limit), end)` — O(log n + limit). Reusing `getEventsRange(...).slice(-N)` was rejected: on a dense gap it materializes the entire `[floor, tail-1]` slice (thousands of events) purely to discard all but the last N, which is exactly the cost the spec's "SHALL NOT examine … in proportion to the seq distance" scenario forbids. The existing `getRangeProbe()` pattern extends to a probe asserting entries-examined is bounded by `limit`, not by the buffer or the range.

**`servedFrom` MUST be re-initialized from the read, not left at the requested `from`.** Today `handleHistoryBackfill` sets `servedFrom = from` and only overwrites it to `slice[0].seq` inside the snap branch. That was safe under the seq-span clamp because `getEventsRange` returned the WHOLE `[from, to]`, so crediting `from` credited a genuinely-served floor. Under a count read the served slice starts ABOVE `from` whenever the gap holds more than `limit` events, so leaving `servedFrom = from` would credit `tailMinSeq = from`, drive `remainingGapCount` to 0, and TERMINATE after one response having served only the newest N — silently dropping every older gap event. The fix: `servedFrom = slice.length > 0 ? slice[0].seq : from` immediately after the read (the snap may then raise it further). This is the crux of the change, not an incidental detail.

**Head-anchored serving stays legacy (no lowest-N store read).** Only the TAIL-anchored path has a shipped caller (the client always requests tail-abutting — `add-tail-only-replay-window`, and D2 keeps it so). The response is count-bounded for BOTH orientations, but the performant `getEventsEndingAt` is added only for the tail path; the head-anchored branch keeps reading its gap-clamped range and taking the first N. A dedicated `getEventsStartingAt` (lowest-N) is deliberately NOT added — it would be speculative machinery for a request no client sends (project simplicity rule). If a head-anchored client is ever introduced, add it then.

### D4 — Termination keys on `remainingGapCount` only

In `useMessageHandler.ts`, drop `msg.events.length === 0` from the `exhausted` predicate: `exhausted = msg.remainingGapCount === 0`. An empty slice with `remainingGapCount > 0` (a fully-superseded compaction result, or — now rare — a genuinely empty sub-range) leaves the gap armed and idle so the next request proceeds. This is the correctness fix; it stands alone even without D1–D3 (the walk would just be slow), and it also closes the second, latent empty-slice trigger (compaction collapsing an all-`message_update` slice to empty) and the head-free premature-`atFloor` path. `remainingGapCount` is trustworthy: the server recomputes it from the store via `countEventsRange` after crediting the moved edge, and the tail retreats even on an empty slice, so the loop cannot livelock (verified against the live session: monotonic tail retreat).

**The one-line predicate edit is NOT sufficient — the two-sided exhaustion branch has its OWN guard.** `useMessageHandler.ts` gates divider removal (A6) on `exhausted && msg.remainingGapCount === 0 && msg.events.length > 0`. An exhausting response that delivers zero events (compaction emptied the final slice, or a snap served nothing at `remainingGapCount === 0`) fails that guard and falls through to the residual branch, which sets `unservable: exhausted` → the exact dead-end this change removes, now fired at TRUE exhaustion. So the fix restructures the branch set:

```
if (msg.error) { …failed: true…; break; }        // UNCHANGED — evaluated FIRST
if (!gap.dividerPlaced) { …clear pending…; break; } // UNCHANGED — divider-less no-op
splice(msg.events);                              // splice BEFORE exhaustion
const exhausted = msg.remainingGapCount === 0;   // events.length dropped
if (exhausted && isHeadFree(gap)) { …floor terminus (atFloor)… break; }
if (exhausted && gap.holey)     { …two-sided not-retained terminus (see D6)… break; }
if (exhausted)                  { …remove divider (contiguous)… break; }
// not exhausted: retreat tail, keep affordance armed; `unservable` never set.
```

Three things the one-line edit alone would break, all preserved above: (1) the `msg.error` branch stays FIRST — every refusal (`not_subscribed` / `out_of_range` / `in_flight` / `stale_generation`) carries `remainingGapCount: 0`, so evaluating the exhaustion predicate before it would misread a refusal as exhaustion and remove the divider instead of showing the `failed` retry; (2) the splice runs BEFORE the exhaustion `break`s — the final response delivers its last ≤N events together with `remainingGapCount === 0`, so breaking first would drop that batch; (3) the two-sided branch splits on `gap.holey` (D6). After this restructure `unservable` is no longer set anywhere on the success path — see D6.

### D5 — Snap after the count read, credit the pre-compaction served bound

The existing gap-facing-edge snap (`snapLowerEdgeForward` for a tail-anchored request) runs on the count-bounded slice exactly as today; `servedFrom` is read post-snap and credited to `tailMinSeq`. **`servedFrom` is the lowest seq of the SELECTED (post-read, post-snap) slice — never the lowest DELIVERED event.** The selection order is: count read (D3) → `servedFrom = slice[0].seq` → snap may raise it → compaction (`compactEventsForReplay(slice, slice.length)`) may drop every event as superseded, delivering `events: []`. The credited `servedFrom` is fixed at the read/snap step, BEFORE compaction, so an empty delivery still retreats the tail and shrinks `remainingGapCount`. Crediting from the delivered (compacted) set instead would leave `servedFrom` undefined on an empty delivery, the client's `tailMinSeq: servedFrom > 0 ? … : gap.tailMinSeq` would retreat nothing, and the identical request would re-issue forever — the livelock the invariant forbids. NOTE: the current server does NOT already do this — it initializes `servedFrom = from` and only sets `slice[0].seq` in the snap branch (see D3); making `servedFrom = slice[0].seq` unconditional after the read is a required code change, not a restatement of existing behaviour. A snap only shrinks, so it can leave `remainingGapCount > 0` where the raw cut would have hit 0 — the walk simply takes one more step, which is correct.

### D6 — A two-sided holey gap resolves to a not-retained terminus (RESOLVED: option B)

An exhausted two-sided gap is classified: HOLEY (retention trimmed its middle) exactly when `gapCount < tailMinSeq − headMaxSeq − 1`, computed from the `history_window` message the client already receives — no wire change. A CONTIGUOUS exhausted gap removes the divider (today's behaviour); a HOLEY one resolves to the not-retained terminus, reusing the head-free `not-retained` row so the elision the module exists to disclose is never silently erased. `unservable` (state A5) is thereby RETIRED — no success path sets it once D4 restructures the branch set; server refusals keep using the separate `failed` state.

Implementation details, each a real decision:
- **`holey` is computed at ANNOUNCE time and scoped to two-sided windows.** `createHistoryGapState` reads the announced `headMaxSeq`/`tailMinSeq`/`gapCount` (still their announced values there, before the walk mutates them) and stores a `holey` boolean. The formula degenerates for a head-free window (`headMaxSeq === 0` sentinel makes it "beginning trimmed", not "middle trimmed"), so `holey` is set `false` for `tail-only` and only ever consulted on the two-sided exhaustion branch — the head-free branch runs first and uses its own floor terminus. Guard against a future refactor consulting `holey` for head-free by gating its computation on `windowShape === "head-tail"`.
- **A DEDICATED terminus flag, not a reused `atFloor`.** `atFloor` is documented as the head-free floor bound; overloading it for a two-sided gap muddies that meaning. Add a distinct flag (e.g. `twoSidedTerminus`) or render the two-sided terminus off `exhausted && holey && !isHeadFree`. The `TerminusRow` `not-retained` presentation in `HistoryGapDivider.tsx` is reused, so this is a render-condition widening + one boolean, not a new component.
- **Orphan cleanup is IN SCOPE (this change creates the orphans).** Retiring `unservable` leaves dead references the change must resolve deliberately: `App.tsx` `!gap.unservable` auto-load guard, `ChatView.tsx` trigger input, `history-gap.ts` `unservable` field + `!t.unservable` in `shouldAutoLoadHistory` + `TriggerInputs`, and the A5 render branch in `HistoryGapDivider.tsx` (`data-testid="history-gap-unavailable"`). Since no path sets `unservable`, these are removed (not left as dead no-ops) per the project's orphan rule — tasks.md carries this as an explicit cleanup task with its own verification.

## Risks / Trade-offs

- **[Older client sends a narrow `[tail-500, tail-1]` window]** → The server still serves whatever events are in that range (now count-capped), so an un-upgraded client keeps working, just as slowly as today. No divergence: the credit/remaining math is identical. Mitigation: none needed — backward compatible.
- **[A dense gap ≫ cap]** → The walk still takes multiple steps, but each delivers a full cap of *events* (not a sparse seq window), so step count is now proportional to events/cap, the true minimum. `getEventsEndingAt` keeps each step O(log n + cap).
- **[`remainingGapCount` computed via `countEventsRange` on a wide range]** → It is a bounded count (binary-search both ends, subtract indices), already O(log n), not a scan. No new cost.
- **[Snap reduces a within-cap final response below the abutting edge]** → Handled by D5; the extra step is bounded and terminates on `remainingGapCount === 0`. NOTE: because of this, the spec's "final request" scenario must NOT assert that the flooring request always reports `remainingGapCount === 0` in the same response — a snap can defer the last event to one further step. The scenario is worded to allow that.
- **[A genuinely-trimmed two-sided gap loses its disclosure]** → Today an unservable two-sided gap shows a persistent "no longer available" line, which — for a HOLEY gap — is the module's disclosure that the middle was elided (`history-gap.ts`: "if the user never learns events were elided, windowing is indistinguishable from data loss"). Removing the divider on exhaustion (option A) drops that disclosure. Resolved by option B (D6): a holey gap keeps a not-retained terminus.
- **[`holey` announce-time snapshot goes stale under a retention race]** → `holey` is captured at announce and never recomputed. If retention trims gap events AFTER announcement but BEFORE exhaustion, a gap announced contiguous can become holey mid-walk; the stored `false` then removes the divider, erasing the disclosure. Accepted, not mitigated: recomputing at exhaustion is impossible (the bounds have converged by then, so the original span is unrecoverable), and the window is narrow (retention firing during an active scroll-back on the same session). Documented here so the snapshot semantics are explicit rather than assumed-static. A future wire-level `holey` flag on `history_backfill_result` would close it, but that is a protocol change this Non-Goal excludes.

## Open Questions

**Q1 — RESOLVED (option B).** What an exhausted two-sided (`head-tail`) gap shows once every stored gap event is loaded: remove the divider for a contiguous gap, resolve to a `not-retained` terminus for a holey one (`gapCount < tailMinSeq − headMaxSeq − 1`). Chosen to preserve the elision disclosure the module's governing constraint requires ("if the user never learns events were elided, windowing is indistinguishable from data loss"). See D6 for the mechanism; the spec carries it as the "two-sided terminus" requirement + the retirement of the `unservable` requirement.

## Migration Plan

In-memory store + client bundle; no data migration. Deploy = server restart (jiti, no build for server/shared) + client build for the request-range/termination change. Rollback = revert the change; the constant reverts to a seq cap and the `exhausted` predicate to its two-term form. The gap data itself is untouched throughout.
