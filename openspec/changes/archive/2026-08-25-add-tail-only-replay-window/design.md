## Context

`lazy-load-session-history` shipped a head/tail replay window with a click-to-load interstitial. `fix-lazy-history-backfill-ux` (in flight, not yet landed) inverts the backfill direction to tail-anchored, adds an `elided` tool status, and deletes the scroll-anchor compensation that the head-first splice required. Issue #521's reporter, after using both, asked for the remaining piece: a transcript that opens on the *recent* messages only and grows upward as he scrolls, with no session-opening head pinned above a divider.

Three constraints shape every decision below.

1. **The window is computed server-side.** `computeReplayWindow` runs inside `sendEventBatches`, so the shape is a server config concern; a browser cannot select it for itself without a protocol change nobody has asked for.
2. **`HEAD_MIN = 20` + `MIN_REPLAY_WINDOW = 100` were built to make a head-free window unreachable** (`lazy-load-session-history` D3). This change reverses that deliberately, and only behind an explicit opt-in.
3. **Three adversarial review cycles found one latent bug in shipped code** — the cold-hydration replay path windows a full stream with no `session_state_reset`, relying on the reducer's `firstSeq === 1` rule, which holds today only because a head-tail window always starts at seq 1. Tail-only turns that latent bug into an immediate one.

## Goals / Non-Goals

**Goals:**

- A configured `tail-only` window delivers a tail segment alone, with the elided region unbounded above and bounded below by the store floor.
- The transcript's first row becomes a loading head that fills upward on scroll proximity, and resolves to a truthful terminus when the store floor is reached.
- `head-tail` behaviour is **observably equivalent** for anyone who does not set the new field. Not byte-for-byte: D3 changes two wire sequences for existing users, both named there.
- The reset guarantee stops depending on a store invariant, on **every** windowed-replay path.

**Non-Goals:**

- Changing the default mode, or the `maxReplayEvents` default (owned by `fix-lazy-history-backfill-ux`).
- Making the window shape a per-browser or per-session preference.
- Revisiting the durable replay cache policy (D10/D12 of `lazy-load-session-history`). This design bounds the cost of *not* caching rather than changing what is cached.
- Retention behaviour, `maxEventsPerSession`, or anything that decides what the store holds.

## Decisions

### D1 — The mode is server config, threaded exactly like `maxReplayEvents`

`memoryLimits.replayWindowMode` is parsed in `packages/shared/src/config.ts` and reaches `BrowserHandlerContext` through the same path as `maxReplayEvents` (`server.ts`, `cli.ts`, `browser-gateway.ts`). Unknown values coerce to `head-tail`, matching the existing `parseMemoryLimits` fallback convention rather than raising.

*Alternatives rejected:* **display-prefs** (`packages/shared/src/display-prefs.ts`) would make it per-browser, which is what the requester actually wants — but the window is computed before any per-client preference is consulted, so honouring it would require the preference to travel with `subscribe` and the server to compute a different window per subscriber. That is a protocol and cache-key change out of proportion to the ask. **Per-session override** compounds the same problem. The consequence is recorded honestly in the spec (`The replay window mode is server-scoped`) and surfaced in the settings hint, rather than papered over.

### D2 — `computeReplayWindow` takes the mode; `HEAD_MIN` stays load-bearing for `head-tail`

Signature becomes `computeReplayWindow(compacted, windowLimit, mode)`. In `tail-only` it returns `{ headEnd: 0, tailStart: len - windowLimit }` after the same fits-entirely short-circuit and the same forward tail snap. `HEAD_RATIO` / `HEAD_MIN` / `HEAD_CAP` are consulted only in `head-tail`, so D3's floor keeps doing its job where it still applies.

*Alternative rejected:* exposing `HEAD_MIN` as config and letting `0` mean tail-only. It reaches the same shape through a knob whose valid range then includes a value that silently changes the transcript's meaning — a worse settings surface, and it would make D3's "head-free is unreachable by configuration" invariant depend on a number rather than on a mode.

*Boundary the return shape breaks:* the announcement block immediately below `computeReplayWindow`'s call site derives `const headMaxSeq = full[replayWindow.headEnd - 1].seq`. At `headEnd === 0` that indexes `full[-1]` and throws on **every** tail-only windowed replay. `headMaxSeq` must be special-cased to `0` when the window has no head; the head slice (`full.slice(0, 0)`) is already benign, and the `gapCount` / `oldestGapSeq` scan (`e.seq > headMaxSeq && e.seq < tailMinSeq`) is correct as written once `headMaxSeq` is `0`.

### D2a — The window shape is ANNOUNCED, not inferred from a sentinel

`history_window` gains `windowShape?: "head-tail" | "tail-only"` — additive, optional, and deliberately mirroring the config field's name and values so the wire and the setting cannot drift apart in a reader's head. The client needs the answer in at least three places — whether to auto-load on scroll at all (`head-tail` stays click-only), whether to floor the request at `oldestGapSeq` (D5), and whether exhaustion removes the divider or resolves to a terminus (D6) — and the client never sees `memoryLimits`, so config cannot reach it.

The available alternative is inferring `headMaxSeq === 0`. Rejected for exactly the reason D4 rejects it server-side: it overloads a numeric bound with a mode signal, and its failure mode is silent. Two engineers reading this design without D2a would build two different clients — one on the sentinel, one on a new field.

This makes the wire change **additive**, not absent. An older client ignoring the field falls back to today's behaviour, which is `head-tail` — the correct fallback, since a server that never sets the mode never sends anything else. The proposal's "no wire-format break" claim is narrowed accordingly: no field is removed or retyped; one optional field is added.

### D3 — The reset moves INTO `sendEventBatches`, replacing per-call-site guards

`sendEventBatches` is the only function that knows a window was actually applied (`replayWindow !== null`). It has **four** call sites — `:571` (stale `lastSeq`), `:616` (warm full stream), `:625` (genuine delta, never windowed), `:693` (cold-hydration fan-out) — and the `session_state_reset` guard sits at two of them (`:562`, `:601`). The hydration fan-out has none, which is the latent bug. Emitting the reset inside `sendEventBatches` when `replayWindow !== null`, immediately before `history_window`, fixes the missing path and makes the delta call site correct by construction (it never windows, so it never resets).

*Alternative rejected:* adding a third guard at `:690`. It fixes today's bug and leaves the shape that produced it — the guard is at the call site, the knowledge is in the callee.

*The asset question is answered, not deferred.* `session_state_reset` reduces to `createInitialState()` (`useSessionState.ts:102-108`, `useMessageHandler.ts:454`) — transcript state only — and `asset_register` is documented as "intentionally a no-op here — it mutates session assets (`SessionAssetsContext`), not `SessionState`" (`useSessionState.ts:21`). The reset does NOT clear the asset registry, so it may safely land after `replaySessionAssets`. No contingency needed.

*Ordering:* reset → `history_window` → `event_replay` batches. The gap affordance must never be announced ahead of the state wipe that precedes its transcript.

**Two sequences change for existing `head-tail` users. Both are believed observably equivalent; neither is nothing:**

1. **The guard's input changes from uncompacted to compacted.** Today `:601` fires on `events.length > fullStreamLimit` — the **uncompacted** count — while `computeReplayWindow` windows the **compacted** array. A 3000-event stream that compacts below a 2000 limit today gets `session_state_reset` + an unwindowed full replay; after D3 it gets the same full replay with no reset. Equivalent because that replay starts at seq `1` and the reducer's `firstSeq === 1` rule resets anyway — which is precisely the store invariant D5 of `lazy-load-session-history` set out to stop depending on. The dependency is removed where it matters (windowed replays) and retained where it is sound (replays that genuinely start at seq 1).
2. **The reset moves after `replaySessionAssets`.** Today both guards fire before it; inside `sendEventBatches` it necessarily lands after. Benign per the paragraph above, but it is a wire-ordering change visible to any client asserting on message order.

Both belong in the test matrix (task 2.3), not in a footnote.

### D4 — Edge crediting becomes orientation-derived, with an explicit `hasHead`

The **server's** `GapState` (`subscription-handler.ts:71`, per-socket, distinct from the client's `HistoryGapState`) gains `hasHead: boolean`, derived from `ctx`'s configured mode at the moment the window is computed — not read back from the announcement it emits. `handleHistoryBackfill` credits:

- the tail bound when `to === tailMinSeq - 1` (retreat `tailMinSeq`);
- the head bound when `from === headMaxSeq + 1` **and** `hasHead`;
- the tail when a range abuts both (`fix-lazy-history-backfill-ux` task 2.2 already makes this the rule).

`hasHead` is an explicit field rather than a `headMaxSeq === 0` sentinel. The sentinel would work — in `tail-only` the head bound never advances, so it stays `0` — but it overloads a numeric bound with a mode signal, and the failing case is silent: `from === 1` with `headMaxSeq === 0` satisfies `from === headMaxSeq + 1`, so the head credit fires on a head that does not exist and poisons every later `remainingGapCount`.

### D5 — The client floors its request at `oldestGapSeq`, and the empty branch still resolves to the terminus

`nextBackfillRange` (post-`fix-lazy`) is `toSeq = tailMinSeq - 1; fromSeq = max(headMaxSeq + 1, toSeq - SPAN + 1)`. In `tail-only` the lower bound becomes `max(oldestGapSeq, toSeq - SPAN + 1)`. Flooring at the announced store floor makes the "request entirely below the floor" case unreachable, so the walk never spends a round trip to learn it is done.

Defense in depth, not instead: the empty-response branch must *still* resolve to the terminus rather than to `unservable`. Today `unservable: exhausted` (`useMessageHandler.ts:826`) is set whenever `events.length === 0`, which in `tail-only` would label *reached the floor* as *nothing servable*. Flooring makes it rare; the branch handling makes it correct. A holey store — where the floor is announced but the range between is empty — is exactly the case that survives the flooring.

*What `oldestGapSeq` actually is:* the lowest gap seq found by scanning `stored` — the full uncompacted store — not a seq-arithmetic bound. For a middle-trimmed store it is therefore the lowest seq genuinely **held**, which is exactly what a request floor needs. The flooring claim rests on that reading and would be wrong for an arithmetic bound.

*Dependency, owned rather than hoped for:* `fix-lazy-history-backfill-ux` leaves task 1.3 (`oldestGapSeq` drop-vs-keep) explicitly as "cleanup, not a blocker" — an unresolved coin-flip this design must not be hostage to. So this change **owns the field**: if task 1.3 lands as a drop, this change re-introduces it. The cost is trivial — it is already computed server-side in the same loop that computes `gapCount`, and re-adding a read on the client is a line. Task 0.2 becomes a branch, not a gate: KEEP → proceed; DROP → restore it as part of task 4.2.

### D6 — The terminus is a divider state, not a row removal

`HistoryGapState` gains `atFloor: boolean`. When a head-free gap exhausts, the loading head becomes a terminal row instead of being spliced out:

- `oldestGapSeq === 1` → "beginning of the session".
- `oldestGapSeq > 1` → "earlier events are no longer retained", **without naming a cause**. `fix-lazy-history-backfill-ux` adds a requirement that the client cannot distinguish retention from replay compaction; `oldestGapSeq` answers *is there anything below*, never *why is it gone*. The spec delta narrows that requirement to cause-only rather than contradicting it.

In `head-tail` the divider is still removed on exhaustion — the head above it explains where the transcript begins. In `tail-only` nothing does, so removing the row would leave a transcript that silently starts mid-conversation.

### D7 — The trigger is a pure predicate called from the existing `handleScroll`

```
lib/chat/history-gap.ts
  shouldAutoLoadHistory({ nearTop, gap, ascending, gestureActive, userHasScrolled }) → boolean
```

`ChatView.handleScroll` already computes `nearTop = el.scrollTop <= SCROLL_THRESHOLD` (`:846`) and already maintains `ascendingRef` for an in-flight programmatic ascent. The predicate is called from there and gates a call to the existing `onLoadEarlier` prop.

Pure, in `lib/chat/`, for the same reason `captureScrollAnchor` was extracted: jsdom reports no layout, so a predicate living inline in a virtualized component has no non-vacuous unit test. This is the central new behaviour of the change; it does not get to be untestable.

**The trigger fires when the loading head is in proximity and the user has expressed upward intent since the last request, evaluated once motion has settled, and only for a head-free window.**

A naive set of latches fails three of the spec's scenarios, and the failures are not obvious:

- *`onTouchStart`/`onTouchEnd` does not cover momentum.* On WebKit, `touchend` fires **before** inertial scrolling begins, so clearing the latch there re-enables the trigger during exactly the momentum phase the spec says to defer.
- *"the first user-driven `handleScroll`" is undefined.* `handleScroll` is bound to `onScroll` and fires for every scroll, programmatic included — the streaming bottom-pin, turn navigation, and the selection-anchor compensator all write `scrollTop`. A transcript that opens short and pinned can sit at `scrollTop === 0`, i.e. `nearTop`, with the latch already set by its own auto-scroll.
- *A splice fires `handleScroll` by itself.* `fix-lazy-history-backfill-ux` establishes that `handleScroll` re-arms mid-flight; after a response splices rows above the viewport, the virtualizer's measurement commit adjusts `scrollTop`, `nearTop` is still true and `pending` is now false — a second request with no user input, chain-loading the gap.

Two weaker rules were considered and rejected. A scroll-**delta** rule fails because `scrollTop` clamps at `0`: a user parked at the loading head produces no further upward delta and the walk stalls. A **rising-edge-of-proximity** rule fails for the same reason one step later — a splice smaller than the ~50px proximity band leaves the user still `nearTop`, so no new edge is ever produced and the walk stalls again. Both mistake a *position* for an *intent*. The rule that works tracks the intent directly.

```
STATE (owned by ChatView, one per session):
  pendingUserIntent : boolean   — the user has asked to go up since the last request
  programmaticScrollUntil : timestamp

SET   pendingUserIntent = true   on any scroll event NOT inside the suppression window,
                                 and on scroll-to-top ACTIVATION (the button is intent,
                                 even though its motion is programmatic)
  CLEAR pendingUserIntent = false on issuing a request, at mount, and on session change

EVALUATION POINT: the settle timer's expiry, and the suppression window's expiry.
  handleScroll only records state and (re)starts the SETTLE_MS timer; it never evaluates.
  A suppressed evaluation changes NO state — it is deferred, not consumed.
  SETTLE_MS = 120.

fires  ⟺  window is head-free                    (announced `windowShape`, D2a — never a sentinel)
       ∧  nearTop
       ∧  pendingUserIntent
       ∧  now > programmaticScrollUntil
       ∧  gap is armed, not pending, not failed, not unservable, not atFloor
```

- **`pendingUserIntent`, cleared on issue,** gives the "one request per expression of intent" bound by construction. A splice cannot chain-load: its scroll events are stamped, so they set nothing, and the flag was cleared when the request went out. A *small* splice that leaves the user in-band does not stall either — any further scroll re-sets the flag.
- **Clearing at mount and on session change** is what kills the first-paint and session-restore cases: a restored transcript can land at `scrollTop === 0` with no intent recorded, so `nearTop` alone never fires.
- **Deferring rather than consuming a suppressed evaluation**, plus evaluating at the suppression window's expiry, is what makes the scroll-to-top landing deterministic: the activation records intent, every intermediate measurement frame is suppressed and changes nothing, and one evaluation runs when the stamp lapses — exactly one request, independent of how many frames the ascent took.
- **Evaluating only at settle expiry** is what makes momentum work: momentum *is* a stream of scroll events, each restarting the timer, so the predicate runs exactly once when inertia stops. Stating the evaluation point is load-bearing — "called from `handleScroll`" plus "only when settled" is a contradiction that yields two different clients.
- **No touch handlers.** WebKit fires `touchend` before momentum begins; the settle timer covers both phases without knowing about either.

**Programmatic scrolls are suppressed by ONE window, not by a list of refs.** `ChatView` writes `scrollTop` or calls `scrollToIndex` from at least five places: the streaming bottom-pin (`:784`), the scroll-to-top ascent (`ascendingRef`), `scrollToTurn` (`:1052-1063`, which sets `descendingRef` but no ascent latch), the session-switch position restore (`:933`, `scrollToIndex(align:"start")` — which drives `scrollTop` to `0` on first paint of a session restored to the top, an unlatched first-paint ascent), and the selection-anchor compensator. Enumerating them is how the previous revision failed: the list grows, and each omission is a silent auto-fetch.

Instead every such writer stamps a shared `programmaticScrollUntil = now + SETTLE_MS` before it writes, and the predicate ignores any edge inside that window. One mechanism, closed to future writers by convention rather than by exhaustive enumeration. `ascendingRef` is no longer consulted by the trigger at all — the scroll-to-top ascent stamps the window like everything else — which also removes the ordering hazard that the latch is cleared inside the same `handleScroll` call that would have evaluated the predicate.

The predicate stays pure: `ChatView` owns the previous-`nearTop` ref, the settle timer, and the suppression stamp; `shouldAutoLoadHistory` receives booleans.

### D7a — In `tail-only` the splice anchors on the first previously-loaded row

`fix-lazy-history-backfill-ux` removes scroll anchoring on the grounds that events now splice *below* the divider, so nothing above the reading position moves. That reasoning holds when the divider is mid-transcript. It fails when the divider is the FIRST row and the user is parked on it: the spliced rows land between the loading head and everything else, so "leave `scrollTop` alone" pins the user to the head while the content they asked for accumulates below — and, with the rising-edge rule, proximity never lapses, so the walk stalls.

In `tail-only` the splice therefore preserves the viewport position of the **first previously-loaded row**: `scrollTop` increases by the spliced height, the newly loaded older messages occupy the space above it, and the loading head scrolls out of proximity. *Approximately*, not exactly — with `overflowAnchor: "none"` and a virtualizer whose newly spliced rows carry estimated sizes until measured, the height at commit is an estimate. The invariant is a bounded drift, not a fixed pixel, and the anchor must keep correcting until measurement settles rather than being consumed by one layout pass — the same failure `fix-lazy-history-backfill-ux` diagnosed in the head-first splice. This is not a new requirement — it is what `The client splices backfilled events into the gap` already demands ("the content the user is currently viewing SHALL remain at the same visual position") once the geometry has no head above the divider. It also re-arms the rising edge for free: scrolling up again is what asks for more.

*Alternative rejected:* keeping fix-lazy's leave-`scrollTop`-alone in both modes and re-arming the trigger on a timer or on a repeated wheel event. That decouples "ask for more" from "scroll to see more", and reintroduces the unbounded auto-walk D9 exists to prevent.

### D8 — The trigger dispatches through `handleLoadEarlier`, not a second path

`App.tsx:843-858` is the sole `history_backfill` dispatch site and owns the disarm guard (`!gap.armed || gap.pending || gap.unservable`), the `toSeq < fromSeq` inversion guard, and the optimistic `pending` flip. The trigger calls the same `onLoadEarlier` prop the button calls. Duplicating the dispatch would duplicate four guards that must not drift.

### D9 — The replay cache policy is unchanged; the trigger's cost is bounded instead

D12 skips the durable cache whenever `gapCount > 0`, and D10 never caches a backfill splice. Both stay. The consequence — every reload of a windowed session cold-misses and re-walks — is priced by one deliberate click today and would become invisible under an auto-trigger. D7's first-paint suppression plus one-request-per-proximity-entry is the bound: a reload lands at the bottom of the tail and fetches nothing until the user scrolls up, exactly as before.

### D10 — Settings exposes a select, and states the scope

A two-option control in Memory Limits beside `maxReplayEvents`, disabled-with-explanation when `maxReplayEvents` is `0`, carrying a restart hint like its siblings, and a hint that names the tradeoff (opening messages omitted) **and** the scope (affects every client of this server). `computeConfigPartial`'s whole-object `memoryLimits` write already persists siblings; the same trap `fix-lazy-history-backfill-ux` documents for `maxReplayEvents` applies here.

## Risks / Trade-offs

- **Moving the reset into `sendEventBatches` regresses `head-tail`** → cover all three call sites with server tests asserting reset-before-`history_window`, including the previously unguarded hydration fan-out. The relocation is the fix for the latent bug, so the tests are the change, not an afterthought.
- **Asset registry ordering** → if `session_state_reset` clears client-side asset state, the delivered window's `pi-asset:` tokens break. Verified during implementation; mitigation is to move the reset ahead of `replaySessionAssets`.
- **N tabs each auto-walk the same gap** → `gapStates` is per-WebSocket by design; the walk is bounded per socket by `remainingGapCount` and per user by requiring scroll. Aggregate load scales with tabs actually scrolled up, which is the same shape as N tabs clicking. Accepted, not mitigated.
- **Server-global setting sold to a single user** → stated in the spec and the settings hint. For a multi-operator deployment this is a real limitation; the mitigation is disclosure, and a per-client mode remains a later change if anyone asks.
- **Archive ordering** → `specs/session-history-backfill/spec.md` MODIFIES a requirement `fix-lazy-history-backfill-ux` ADDs. Archiving this change first will fail to locate the target. Header comments in both delta files record it.
- **`oldestGapSeq` may be dropped by the prerequisite** → no longer a blocking risk: this change owns the field and restores it if dropped (D5).
- **`SETTLE_MS = 120` is the aggressive end of the range** → WebKit inertial scrolling can emit events for 100–300ms after `touchend`, so on a slow device momentum may outlast the window and produce a mid-fling fire. Accepted deliberately: the failure is one early fetch of data the user is scrolling toward anyway, whereas a 400ms window makes the loading head feel dead. Scenario F7 pins the boundary so a regression is visible; task 8.4 may raise it if the early fire proves common rather than theoretical.
- **The programmatic-suppression window depends on every `scrollTop` writer stamping it** → a future writer that forgets reintroduces the unlatched-ascent bug. Mitigated by keeping the stamp adjacent to the write and by a test that drives each existing writer and asserts no request results; not enforceable by the type system.
- **D7a reintroduces scroll anchoring that `fix-lazy-history-backfill-ux` deletes** → scoped to `tail-only`, where the geometry differs. The head-tail path keeps fix-lazy's deletion; a test must pin that the two modes do not share the branch.
- **D7a also inverts fix-lazy's compensator suppression, which the anchor risk above does not cover.** fix-lazy suppresses the selection-anchor compensator (`ChatView.tsx:1003-1051`) and the grow-pin (`:784`) for the splice commit, reasoning that a tail-anchored splice inserts *below* the reading position so nothing above it moves. Under D7a the splice inserts **above** everything below the loading head — so a user holding a selection mid-transcript while the loading head fills is exactly the case the compensator exists for, and suppressing it is wrong. In `tail-only` the compensator must stay ACTIVE across the splice commit; only `head-tail` inherits fix-lazy's suppression. Covered by scenario F18.
- **The `programmaticScrollUntil` stamp must reach ~9 writers, not the 5 named in D7** → `ChatView` writes scroll position at `:424` (ref restore), `:784` (bottom-pin), `:791` (ascent re-issue), `:906` (scroll-to-top), `:933`/`:937` (restore + offset), `:983` (scroll-to-bottom), `:1036` (selection compensator), `:1062` (`scrollToTurn`). The enumeration in D7 is illustrative, not exhaustive; the implementation task must sweep the file. Scenarios F5, F6, F19, and F20 drive the four riskiest.
- **Accessibility of auto-inserted content** → resolved: every **automatically triggered** load **in `tail-only`** announces its count through an `aria-live="polite"` region ("20 earlier messages loaded"), so a screen-reader user learns content appeared above them without a gesture of their own. Polite, not assertive — the insertion is never urgent and must not interrupt reading. The splice never moves focus. **Explicitly scoped**: a `head-tail` click-to-load produces no new announcement, because a user who pressed a button already knows what they asked for and a non-opted-in user must observe nothing new.

## Migration Plan

Additive and default-preserving. `replayWindowMode` absent → `head-tail` → today's behaviour on every path. Rollback is unsetting the field (or setting `maxReplayEvents: 0`, which makes the mode inert entirely); both take effect on server restart, consistent with the rest of `memoryLimits`.

The wire change is **additive, not absent**: `history_window` gains one optional shape field (D2a); no field is removed or retyped, and an older client that ignores it falls back to `head-tail`, which is what a non-opted-in server sends anyway. `headMaxSeq`'s documented range widens from `>= 1` to `>= 0` — a doc-comment contract, not a validated one, so "widening" it is editing the comment and the spec, with no runtime validator to change.

Sequencing is strict: `fix-lazy-history-backfill-ux` must be implemented, archived, and its task 1.3 resolved as KEEP before this change begins.

## Open Questions

All four questions this design opened were resolved at the `scenario-design` gate and folded into the decisions above: `SETTLE_MS = 120`; the wire field is `windowShape?: "head-tail" | "tail-only"`; the a11y policy is a per-load `aria-live="polite"` count announcement; the trigger's performance budget is **`handleScroll` bookkeeping under 1ms p95 per event across a 5s continuous scroll**.

Remaining, and genuinely open:

- **Should the terminus offer anything?** A "load everything" escape hatch on the terminal row is cheap and would serve the archaeology case the head segment used to serve. Deferred: it reintroduces the unbounded fetch this design spends effort bounding.
- **Is `SCROLL_THRESHOLD = 50` the right proximity band?** Reused because it already exists and already computes `nearTop`. It was tuned for showing a control, not for prefetching a round trip. Revisit only if the fetch visibly lags the scroll.
