## Context

The dashboard sidebar groups session cards by folder. Inside each folder, cards are split into two tiers: **alive** (status ≠ "ended") on top, **ended** at the bottom. Ordering inside each tier is governed by:

- `sessionOrderManager` — server-side, persisted per cwd. Stores **alive ids only** (the alive→ended branch in `server.ts onChange` prunes ids on transition; the ended→alive branch re-inserts on user intent).
- Client renderer (`SessionList.renderGroup` + `sortSessionsByOrder` in `session-grouping.ts`) — composes `orderedIds` (from `sessionOrder`, filtered to currently-visible ids) with a tail of "unordered" ids (sessions present but not in the persisted order). The tail is sorted by `startedAt` descending.

This design works for the steady state but breaks at tier-transition moments:

```
   Alive tier                                      Ended tier
   ──────────                                      ──────────
   sessionOrder governs              ←→            no persisted order;
   (drag-reorder + auto-prepend                    fallback sort by
   on resume + auto-prepend                        startedAt desc
   on new session)
```

Two failure modes follow:

1. **Resume re-cycle**. Commit `deb95be` made the ended→alive branch insert via `sessionOrderManager.insert(cwd, id)` only `if (!order.includes(sessionId))`. For a fresh resume after the id was pruned, `insert` prepends and the card lands at top — correct. But for **end → resume → end → resume** sequences, the second resume can find the id already in the list (it's pruned on alive→ended via `remove`, but a `restore`/scan path can leave it stale in some race orderings). More importantly, the conditional shape encodes "first time only" semantics, which contradicts the user-intent meaning ("I want to see this now").
2. **Just-killed lands mid-bucket**. The ✕ button (and natural pi exits) trigger the alive→ended branch, which calls `sessionOrderManager.remove(cwd, id)`. The id is then "unordered" and falls into the renderer's tail, sorted by `startedAt` desc. A 14 h-old session that was just killed sorts among other 14 h-old ended sessions instead of at the top of the ended tier where the user would expect to see it.

Both are tier-transition-time bugs: the ordering layer doesn't react to *when the transition happened*.

## Goals / Non-Goals

**Goals:**

- ✅ A session that just transitioned **alive → ended** (any cause: ✕ shutdown, natural pi exit, force-kill) renders at the **top of the ended tier** in its folder.
- ✅ A session that just transitioned **ended → alive** via user intent (Resume button, drag-to-resume, REST resume) renders at the **top of the alive tier** in its folder, even on repeated resume cycles.
- ✅ The bridge auto-reattach path (dashboard reboot, pi process still alive) continues to **preserve the user's existing layout** — no top-of-tier jump. This is the existing `pendingResumeIntents` gating contract; we don't weaken it.
- ✅ Symmetric: same mechanism conceptually for both directions, even if the implementations differ (ended uses `endedAt` sort; alive uses `sessionOrder` move-to-front).

**Non-Goals:**

- ❌ Persist a separate `endedSessionOrder` list. Ended tier ordering remains computed from `endedAt`. No new persistence schema, no migration.
- ❌ Allow the user to manually drag-reorder within the ended tier. (Out of scope; current drag is alive-only.)
- ❌ Change the active/ended split rendering or the `endedExpanded` per-folder collapse. Those layers are orthogonal.
- ❌ Change the protocol. `sessions_reordered` payload semantics stay identical; the data flowing through it just reflects move-to-front semantics on resume.

## Decisions

### D1: Ended tier sorts by `endedAt` (computed, not persisted)

Add `endedAt` to the sort key for ended sessions. Two sub-decisions:

**D1a — Where to apply the sort:** Inside the renderer's per-folder split (`SessionList.renderGroup`), not inside `sortSessionsByOrder`. Reason: `sortSessionsByOrder` is also used by the pinned/unpinned grouping path and shouldn't grow status-aware behavior. The renderer already separates `activeSessions` from `endedSessions` (the `flatMergeMode` branch confirms this); we just sort the latter array differently.

```ts
// inside renderGroup, after the active/ended split
const endedSessionsSorted = [...endedSessions].sort(
  (a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt),
);
```

The composition with `orderedIds` (which is alive-only by construction post-prune) is unaffected — ended ids never appear in `orderedIds`, they only flow through the unordered-tail path. The new sort replaces the implicit `startedAt` desc that `sortSessionsByOrder`'s "unordered" branch provides today, *for the ended tier only*.

**Alternatives considered:**

- **Persist `endedSessionOrder` per cwd, prepend on alive→ended.** Symmetric with `sessionOrder` but adds a second persisted list, doubles the broadcast surface, and creates eviction/expiry questions ("how many ended sessions do we remember the order for?"). For a list whose only natural order is "most recently ended", a computed `endedAt` sort gets us the same result for free.
- **Re-use `sessionOrder` for both tiers (Option B from explore).** Drop the alive→ended `remove` and prepend the id instead. But the existing design comment ("drag-reorder is meaningful for live sessions only; ended ones must fall to the bottom in their natural startedAt order rather than retaining a position that interleaves them with active sessions") is correct: with the renderer's active/ended split this would **not** interleave, so it's technically safe today, but it would also mean a future resume of that id calls `insert` against a list where it's already present — directly conflicting with D2's move-to-front semantics. Rejected to avoid coupling the two tiers' state.

### D2: Resume = move-to-front, not insert-if-absent

In `server.ts onChange`, the ended→alive user-intent branch currently reads:

```ts
const order = sessionOrderManager.getOrder(session.cwd) ?? [];
if (!order.includes(sessionId)) {
  sessionOrderManager.insert(session.cwd, sessionId);
}
```

Replace with a move-to-front:

```ts
sessionOrderManager.remove(session.cwd, sessionId);   // idempotent; no-op if absent
sessionOrderManager.insert(session.cwd, sessionId);   // prepends
```

Optionally introduce `sessionOrderManager.moveToFront(cwd, id)` as a single call wrapping `remove` + `insert`, so future call sites don't have to repeat the pattern and the semantics are visible at the call site.

**Alternatives considered:**

- **Keep insert-if-absent.** Minimum diff, but the failure case (resume cycles) is real — see Risk R1 below — and the user-mental-model contract is "resume = bring this back to the top" regardless of history.
- **Always prepend on session_register, regardless of intent.** Would drag bridge-auto-reattach sessions to the top on every dashboard reload, which is exactly what `deb95be` was added to *prevent*. Rejected: the gating contract stands.

### D3: No protocol changes

Both fixes are pure server-side ordering plus client-side sort. The server emits the same `sessions_reordered` broadcast it always does — D2 just changes what's *in* the payload (id at index 0 vs. id at its previous position). D1 is entirely client-side and emits no events at all.

This means the change rolls forward and back cleanly with no version skew between dashboard server and connected browsers.

## Risks / Trade-offs

**[R1: D2 changes behavior for users who previously dragged an alive session below others, then ended it, then resumed it]** → After resume, the session jumps to the top instead of returning to its dragged position.

  - *Mitigation*: This matches the explicit user-intent contract ("resume = surface this now"). The previous behavior was an accidental side effect of insert-if-absent semantics. Documented in the spec scenario.

**[R2: D1 sorts purely by `endedAt`, ignoring user intent for a session that ended a long time ago and was just clicked/inspected]** → If a user opens a 1-week-old ended session, its position doesn't change (it stays in `endedAt` order).

  - *Mitigation*: Inspection isn't a tier transition. The bug we're fixing is "card I just acted on disappears into the bucket" — and "act on" means status change, not click. Out of scope to reorder on click.

**[R3: `endedAt` is currently nullable on the `DashboardSession` type for legacy reasons]** → Some pre-migration sessions may have undefined `endedAt`.

  - *Mitigation*: The proposed sort uses `endedAt ?? startedAt` as the fallback, which is the existing implicit behavior. No regression.

**[R4: D1 changes ordering for users who relied on `startedAt` desc within ended tier]** → Long-running sessions that ended quickly used to sort above short-running sessions that ended later (because `startedAt` was earlier-but-greater). After D1, short sessions that ended later sort first.

  - *Mitigation*: This is the correct semantic ("most recent first"). The previous sort was an artifact of the renderer's unordered-tail fallback, not an explicit design decision. Surfaced in the spec scenarios so the new behavior is documented.

## Migration Plan

No data migration required. Pure code change:

1. Land D1 (client-side sort) and D2 (server-side move-to-front) together to keep the symmetric contract intact.
2. No backfill of `endedAt` needed — the `?? startedAt` fallback handles legacy sessions that were ended before `endedAt` was tracked.
3. Roll-forward only. If the change needs to be reverted, revert both D1 and D2 commits; older clients/servers will continue to work because the protocol is unchanged.

## Open Questions

1. **Should we add a `moveToFront(cwd, id)` helper to `sessionOrderManager`?** Keeps the call site declarative. *Decision deferred to implementation — judgment call based on whether other paths grow that need it.*
2. **Should ended sessions show their `endedAt` in the card UI?** Currently only `startedAt`-relative time is shown. Out of scope for this change but worth a follow-up if users frequently scan the ended tier.
