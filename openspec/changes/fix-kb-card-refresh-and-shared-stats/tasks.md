# Tasks — fix-kb-card-refresh-and-shared-stats

## 1. Shared per-cwd stats store

- [ ] 1.1 Extract the fetch/poll/pending/error state machine from `useKbStats.ts` into a module-level per-cwd store (`Map<cwd, store>`) with subscribe/getSnapshot, refcounted lifecycle per design D2 (create+fetch on first subscriber; background revalidate coalesced with in-flight fetch on later subscribers; on last unsubscribe stop poll, keep guard armed, never abort in-flight fetch; epoch-ordered fetches; idle-retry parity; null-cwd inert), and a test-only `resetKbStatsStores()`
- [ ] 1.2 Reimplement `useKbStats(cwd)` as a thin `useSyncExternalStore` subscription preserving the existing `UseKbStatsResult` shape; keep `POLL_MS`, `MAX_POLL_MISSES`, `REINDEX_GUARD_MS` semantics unchanged (design D4)
- [ ] 1.3 Add store-level in-flight no-op guard on `reindex()` while pending/indexing (design D4 risk mitigation)

## 2. Card-placement inline reindex control

- [ ] 2.1 In `FolderKbSection.tsx`, render a compact state-varying reindex icon-button as a SIBLING of `SlotPill` (outside the pill root) when `placement === "card"` — glyph `mdiDatabaseRefreshOutline`, `aria-label` + wrapper-`span` `title` Retry / Index now / Reindex now (perceivable while disabled), disabled while `busy`, activation calls `reindex()` only and never opens settings, `data-testid="folder-kb-card-reindex"`; sidebar placement untouched (design D3)
- [ ] 2.2 Add `resetKbStatsStores()` to `beforeEach` in every existing kb-plugin client test file and scope the existing "pill exposes no action control" assertion to the pill root

## 3. Tests — shared stats store (L1, see packages/kb-plugin/src/client/__tests__/useKbStats.test.tsx)

- [ ] 3.1 Test distinct folders stay independent: two stores subscribed for cwd A and B, both settled; reindex() on A; B's snapshot unchanged, pending false, no fetch for B (test-plan #E3)
- [ ] 3.2 Test guard at zero subscribers: reindex() fired then last consumer unsubscribes before a poll sees indexing:true; advance fake timers past 4000ms; pending cleared in retained snapshot, no fetch at zero subscribers, remounting consumer sees control enabled (test-plan #E4)
- [ ] 3.3 Test revalidate-on-subscribe coalescing: new consumer on settled store → synchronous snapshot + exactly one background fetch; new consumer while fetch in flight → snapshot + zero additional fetch (test-plan #E5)
- [ ] 3.4 Test one poll loop per folder: two consumers on one cwd with indexing:true; advance fake timers 3000ms; exactly 3 stats fetches issued, not 6 (test-plan #E6)
- [ ] 3.5 Test cross-consumer convergence: two hook consumers on one cwd, mocked fetch idle→indexing→settled new counts; reindex() from A; B converges pending→indexing→settled without remount, snapshots referentially identical (test-plan #F1)
- [ ] 3.6 Test shared busy window: reindex() from consumer A; consumer B disabled for the whole pending+indexing window and activating B issues no second POST (test-plan #F4)
- [ ] 3.7 Test poll ticks never toggle loading: store polling during indexing:true; loading stays false across 1s ticks, only initial/revalidate/refetch epochs set it (test-plan #F5)
- [ ] 3.8 Test remount shows settled snapshot: reindex settles while only A mounted; A unmounts; B mounts later and renders settled counts immediately (no stale flash) then background revalidate fires (test-plan #F7)
- [ ] 3.9 Test shared error channels: reindex POST rejects (500) from panel consumer; BOTH consumers show error state; subsequent reindex() from the other consumer clears it (test-plan #X1)
- [ ] 3.10 Test epoch ordering: older fetch epoch resolves after a newer one via delayed promises; snapshot reflects the newer epoch, stale response discarded (test-plan #X2)
- [ ] 3.11 Test miss tolerance under shared store: 2 consecutive poll failures then success → no error to either consumer, spinner retained; 3rd consecutive failure → error surfaced to both, poll stopped (test-plan #X3)
- [ ] 3.12 Test lifecycle churn: subscribe→unsubscribe→resubscribe within one tick while first fetch in flight; result lands in snapshot, no AbortError, no duplicate fetch (test-plan #X4)

## 4. Tests — card sibling control (L1, see packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx)

- [ ] 4.1 Test sibling control state table: card-placement section with stats forcing error / indexing / not-indexed / stale / populated; accessible name is Retry / disabled-in-progress / Index now / Reindex now / Reindex now, label perceivable via wrapper title while disabled (test-plan #E1)
- [ ] 4.2 Test DOM structure: card placement renders exactly one `folder-kb-card-reindex` as sibling of the pill with zero interactive elements inside the pill's role=button root; sidebar placement renders none (test-plan #E2)
- [ ] 4.3 Test activation never opens settings: pointer click AND keyboard Enter/Space on `folder-kb-card-reindex` issue the reindex POST and wouter navigation is not called (test-plan #F3)

## 5. Tests — e2e (L3, see tests/e2e/kb-folder-slot.spec.ts)

- [ ] 5.1 Extend `tests/e2e/kb-folder-slot.spec.ts`: with `/fixtures/kb-sample` pinned, KB settings overlay open and sidebar KB row visible, click `kb-reindex-now` in the settings panel; sidebar `folder-kb-section` `data-state` reaches `populated` with updated `folder-kb-count` WITHOUT page reload (test-plan #F2)

## 6. Manual verification

- [ ] 6.1 Manually check the sibling button's visual fit on the worktree session card across themes — compact, aligned with the flat pill, not crowding the subcard row (test-plan: manual-only)

## 7. Docs

- [ ] 7.1 Update `packages/kb-plugin/src/client/AGENTS.md` rows for `useKbStats.ts` and `FolderKbSection.tsx` (shared store, card sibling control, consumer-count caveats)
