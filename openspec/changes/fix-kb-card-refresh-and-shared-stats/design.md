# Design — fix-kb-card-refresh-and-shared-stats

## Context

See proposal.md — Why. Two consumers (`FolderKbSection`, `KbSettingsPanel`) each call `useKbStats(cwd)`, which today holds all state per hook instance (`useState` + per-instance poll interval + optimistic-pending guard). The card placement lost its reindex affordance when `move-slot-actions-to-menu` folded actions into the folder-actions-menu item, which the card scope cannot render.

Constraints:

- The public hook shape `UseKbStatsResult` (`stats/loading/error/reindexError/pending/reindex/refetch`) has two consumers and tests; keep it stable.
- All existing per-instance behaviors are spec'd (`kb-plugin-stats`): 1s poll while indexing, MAX_POLL_MISSES=3 tolerance, optimistic pending with REINDEX_GUARD_MS, two error channels. These must survive the refactor unchanged, just hoisted to per-cwd scope.
- Plugin client — no core/shell edits, no server changes.

## Goals / Non-Goals

**Goals**

- One shared state + one poll loop per cwd; every `useKbStats(cwd)` consumer subscribes to the same snapshot.
- Card placement gets a direct reindex control as a sibling of the pill (outside the pill root); sidebar stays menu-only.

**Non-Goals**

- No server push (WS/SSE) for KB stats — polling stays the transport.
- No cross-tab sharing (BroadcastChannel etc.) — scope is one client runtime.
- No change to the sidebar menu item, the settings panel's controls, or the `/api/kb/*` endpoints.

## Decisions

### D1 — Module-level per-cwd store with subscriber pattern (`useSyncExternalStore`)

A module-scoped `Map<cwd, KbStatsStore>` where each store owns: snapshot (`stats/loading/error/reindexError/pending`), the poll interval, miss counter, and guard timer. `useKbStats(cwd)` becomes a thin subscription via `useSyncExternalStore` (client is React 19; the API is stable since 18) returning the store snapshot plus stable `reindex`/`refetch` bound to the store. **Snapshot identity is load-bearing:** `getSnapshot` MUST return a cached, referentially stable object, replaced only when state actually changes, and the bound callbacks must be stable — otherwise the hook re-render-loops (repo precedent: `packages/client/src/hooks/usePackageOperations.ts` / `git-status-cache.ts`).

- **Why over per-instance + custom event bus (Option C):** the bus only broadcasts triggers; two poll loops still race and can disagree transiently. The store makes agreement structural.
- **Why over refetch-on-dialog-close (Option B):** misses the live indexing window on the card; couples the fix to routing.
- **Why over React context:** the section and the overlay route mount in different subtrees; a context provider would have to live in the shell, violating the plugin-local constraint. A module singleton needs no host cooperation.

### D2 — Store lifecycle: refcounted subscribe, bounded teardown on last unsubscribe

- **First subscriber for a cwd** → store created, fetch issued immediately (`loading` true).
- **Subscriber joins a live store** → retained snapshot served synchronously, background revalidate issued, **coalesced** with any in-flight fetch for that cwd (one request, results fan out). This preserves the per-mount "fetch on mount" observability contract — external mutations (CLI reindex, another client) are still seen — while eliminating duplicate concurrent requests. The proposal's traffic claim is exactly this: coalescing + one poll loop, not "no fetch per mount".
- **Last unsubscribe** → stop the poll interval; **do NOT abort an in-flight fetch** (its result writes into the retained snapshot — also makes React StrictMode's dev-mode subscribe/unsubscribe/subscribe churn harmless); **keep the optimistic guard timer armed** — it is bounded (`REINDEX_GUARD_MS`) and, if it fires at zero subscribers, self-clears `pending` without fetching, closing the unmount→remount double-submit hole; if a subscriber re-joins before it fires, the guard keeps today's semantics (fire → clear `pending` + refetch). `reindexError` is retained (it is real folder state); it clears on the next `reindex()` from any consumer.
- **Snapshot retention**: the `Map<cwd, store>` entry is never evicted. Accepted: bounded by folders visited in one client runtime, each snapshot is a handful of scalars.
- **`loading` semantics**: `true` while an initial, revalidate-on-subscribe, or post-reindex `refetch()` epoch is in flight; **poll ticks never toggle `loading`** (parity with today, where only the effect-body fetch sets it — otherwise `statsLoading` would flap every second during a walk). This preserves the settings panel's `busy = pending || statsLoading || indexing` reindex gate (PR #568: an unobserved in-flight job must not invite a redundant POST).
- **Fetch ordering**: the store owns one epoch counter + `AbortController` per cwd; a new epoch aborts/supersedes the old, and stale-epoch responses are discarded — out-of-order poll/revalidate/refetch responses can never overwrite newer state (preserves today's per-effect abort semantics).
- **Idle-retry parity**: the current hook retries a transient miss even when NOT indexing (a lone initial-load blip schedules a retry interval instead of abandoning the fetch). This behavior moves into the store unchanged — poll-only-while-indexing plus this idle-retry path, with the same `MAX_POLL_MISSES` bound.
- **Null cwd**: no store entry; the hook returns the inert empty result (matches today's `!cwd` branch).

### D3 — Card reindex control: SIBLING of the pill, never inside the pill root

An element inside `SlotPill`'s `role="button"` root is an ARIA anti-pattern (the runtime removed its `actions` prop for exactly this) and a keyboard trap: the pill root's Enter/Space `onKeyDown` would both navigate to settings and `preventDefault()` the inner button's click. And `directory-card-layout` mandates state-only pills. So the control renders as a **sibling** of `SlotPill` inside the section's wrapper `div`, only when `placement === "card"`:

- Compact icon-button, glyph `mdiDatabaseRefreshOutline` (matches the sidebar menu item), `data-testid="folder-kb-card-reindex"`.
- State-varying accessible name/tooltip: Retry / Index now / Reindex now (exact strings of the existing menu item — `titleReindexNow` et al.). No badge — the pill's inline stale marker already carries that fact on the card. The label lives on a wrapping `span`'s `title` (disabled buttons swallow mouse events in most browsers, so the tooltip must survive the disabled `indexing` window) plus `aria-label` on the button.
- Disabled when `busy`; keyboard and pointer activation call `reindex()` only — as a sibling outside the pill root, no event reaches the pill's `onActivate`.
- Sidebar placement renders no sibling control — actions there stay in the folder actions menu.
- A clarifying `directory-card-layout` delta scopes the state-only rule to the pill root and sanctions at most one sibling control in the card placement.

- **Why not inside the pill (rejected):** spec violation + ARIA nesting + keyboard trap, above.
- **Why not extend `SlotPill` with an action prop:** deliberately removed; host can't group/keyboard-navigate opaque nodes.
- **Why not plugin items in `WorktreeActionsMenu`:** doctrine-pure but requires new runtime plumbing + host + shared-type changes for one item; deferred (user chose the sibling shape).

### D4 — Keep hook API and error semantics compatible

`MAX_POLL_MISSES`, `POLL_MS`, `REINDEX_GUARD_MS` move into the store unchanged. The consumer-side derived `busy` guard stays consumer-side (both consumers already implement it; the spec's shared-busy scenario is satisfied because both derive from the same snapshot). Store-level in-flight no-op guard on `reindex()` while pending/indexing as defense-in-depth.

**Deliberate semantic change (shared errors):** `reindexError`/`error` become folder state visible to every consumer — a settings-panel trigger reject now flips the sidebar/card section to the error state too. This is intended (the failure is true state, and the sidebar's menu offers Retry); it is spec'd in the stats delta, not an accident of the refactor.

## Risks / Trade-offs

- [Module singleton state leaks across tests] → store module exposes a test-only `resetKbStatsStores()`; ALL `useKbStats`/section/panel tests call it in `beforeEach` (existing test files must be updated, not only new ones).
- [Timer lifecycle bugs (poll stopping / guard surviving last unsubscribe)] → teardown asserted by unit tests with fake timers; refcount logic centralized in one subscribe/unsubscribe pair.
- [`useSyncExternalStore` snapshot identity churn causing re-render loops] → snapshot object replaced only on actual state change; `getSnapshot` returns the cached object.
- [Two consumers triggering reindex near-simultaneously] → store-level in-flight check makes `reindex()` a no-op while pending/indexing (defense-in-depth behind the UI `busy` guards).
- [Shared error surfacing surprises users (sidebar shows a dialog-caused failure)] → accepted; the error is real folder state and Retry is one click away. Documented in D4.
- [Existing assertion churn] → `FolderKbSection` test "pill exposes no action control" becomes pill-root-scoped (the card sibling control is sanctioned); folded test tasks carry the exemplar pointers.

## Migration Plan

Pure client refactor inside `packages/kb-plugin`. Ship as one change; no data or API migration. Rollback = revert the commit.
