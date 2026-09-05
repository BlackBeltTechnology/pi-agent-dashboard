# Fix KB card refresh affordance + shared per-cwd stats

## Why

Two user-visible defects in the KB folder section:

1. **The worktree-card placement has no direct reindex affordance.** The `move-slot-actions-to-menu` change folded the pill's action controls into ONE folder-actions-menu item, but the card placement has no folder actions menu, so `FolderKbSection` registers nothing there (`menuScope = null`). The only path from the card is pill → KB settings page → "Reindex now" — a two-hop detour for the most common KB action.

2. **Stats do not propagate between consumers.** `useKbStats(cwd)` is a per-instance hook: each consumer fetches once on mount and polls only while *it* observes `indexing:true`. Triggering a reindex from the KB settings dialog updates the dialog's own instance, but the card/sidebar section's instance never refetches — it shows its mount-time snapshot indefinitely. The two surfaces disagree about the same cwd's KB state.

## What Changes

- **Shared per-cwd KB stats store.** Replace per-instance fetch/poll state in `useKbStats` with a module-level per-cwd store (subscriber pattern): one poll loop per cwd, every mounted `useKbStats(cwd)` consumer subscribes to the same snapshot. A `reindex()` triggered from ANY consumer (settings panel, sidebar section, card section) updates all of them — optimistic `pending`, live `indexing` polling, error channels, and settled counts included. A consumer mounting onto a live store shows the retained snapshot immediately and triggers a background revalidate (coalesced with any in-flight fetch), so external mutations are still observed while concurrent duplicate polling is eliminated.
- **Card-placement reindex affordance (sibling control).** Give the card placement the same single state-varying reindex action (Retry / Index now / Reindex now, disabled while busy) as a compact icon-button rendered **next to** the pill — NOT inside it. The pill root stays state-only in every placement (per `directory-card-layout` — "pills read a number"), avoiding the nested-button ARIA anti-pattern `SlotPill` deliberately removed. Scoped to `placement === "card"` only; the sidebar section and its menu item are unchanged.
- No server/API changes; `/api/kb/stats` and `/api/kb/reindex` are untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kb-plugin-stats`: stats retrieval/polling/optimistic-pending become per-cwd shared state observed identically by all concurrent consumers, instead of per-hook-instance state.
- `kb-plugin-folder-section`: the "Reindex action affordance" requirement gains a card-placement sibling control — a compact reindex control next to the pill (the pill itself stays action-free in every placement).
- `directory-card-layout`: the placement-variant requirement is clarified — the state-only rule binds the pill root; a card-placement folder section MAY render one sibling action control outside the pill root.

## Impact

- `packages/kb-plugin/src/client/useKbStats.ts` — refactor to shared per-cwd store + subscription hook (public hook shape `UseKbStatsResult` preserved for both existing consumers).
- `packages/kb-plugin/src/client/FolderKbSection.tsx` — card-placement inline action control; sidebar menu item untouched.
- `packages/kb-plugin/src/client/__tests__/` — new tests: two-consumer sharing (reindex in one updates the other), card affordance states, double-submit guard across consumers; existing `useKbStats` tests gain a store reset in `beforeEach`, and the placement-unconditional "pill exposes no action control" assertion becomes pill-root-scoped.
- No changes to `packages/server`, `packages/shared`, or the kb engine.

## Discipline Skills

- `review-code` — non-trivial client refactor (hook → shared store) before commit.
- No security-hardening / performance-optimization / observability triggers: no untrusted input, no new endpoint, no latency budget (the change *reduces* request volume).
