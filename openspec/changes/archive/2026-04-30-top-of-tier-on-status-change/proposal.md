## Why

When a session transitions between alive and ended tiers in the sidebar, the user expects the just-changed card to surface at the **top of its new tier** so they can act on it. Two paired bugs violate this:

1. **Resume (ended → alive)** historically left the card wherever it was; commit `deb95be` already partially fixed this by gating `sessionOrderManager.insert` behind user intent. But because `insert` is conditional (`!order.includes(sessionId)`), an id that was *already* in the order list — e.g. resume → end → resume sequences — wouldn't get re-prepended.
2. **Shutdown ✕ / natural-end (alive → ended)** removes the id from `sessionOrder` entirely, leaving the renderer to fall back to `startedAt`-descending sort within the ended tier. A session started 14 hours ago that was just killed lands mid-bucket among other 14 h-old ended sessions instead of at the top — invisible to the user who just acted on it.

Both failures share one root cause: ordering decisions are bound to `startedAt` and a single alive-only `sessionOrder` list, with no awareness of *when the tier transition happened*. Symmetric "top of tier on transition" behavior fixes both.

## What Changes

- **Ended tier sort key**: when rendering the ended-sessions bucket inside a folder, sort by `(endedAt ?? startedAt)` descending instead of `startedAt` descending. The most recently-ended session lands at the top of the ended tier — regardless of cause (✕ shutdown, natural pi exit, force-kill).
- **Resume re-prepend**: in the server's `onChange` ended→alive branch, when a `pendingResumeIntents` tag is present, **always** move the id to the front of `sessionOrder` for its cwd — not only insert when absent. Covers the "end → resume → end → resume" cycle where the id is already in the list.
- **No persisted `endedAt` order list**: ended-tier ordering stays *computed* from `endedAt` rather than persisted. The existing design comment in `server.ts` ("drag-reorder is meaningful for live sessions only; ended ones must fall to the bottom in their natural startedAt order") is updated to read "natural endedAt order" — same intent, more accurate sort key.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `session-ordering`: extend the rendering and tier-transition rules so that the just-changed card surfaces at the top of its new tier. Specifically:
  - Append a new tier-sort requirement covering ended-bucket ordering by `endedAt`.
  - Update the resume requirement to make `sessionOrderManager.insert` move-to-front rather than insert-if-absent when triggered by user intent.

## Impact

- `packages/client/src/lib/session-grouping.ts` — `sortSessionsByOrder` (or the per-folder split inside `SessionList.renderGroup`) gains an `endedAt`-aware path for the ended tier.
- `packages/client/src/components/SessionList.tsx` — the `renderGroup` ordered/tail composition consumes the new sort.
- `packages/server/src/server.ts` — the `onChange` ended→alive branch's `if (!order.includes(sessionId))` guard is replaced by a move-to-front (`remove` + `insert`) operation when `pendingResumeIntents.consume()` returns true.
- `packages/server/src/session-order-manager.ts` — possibly add a `moveToFront(cwd, id)` helper to keep the call site clean; no protocol changes.
- Tests: `session-grouping.test.ts` gets cases for ended-tier sort by `endedAt`; a new server test covers the resume-cycle case (`end → resume → end → resume` lands at top each time).
- No protocol or persistence-format changes. No data migration. Pure ordering refinement on top of the existing `sessions_reordered` broadcast machinery.
