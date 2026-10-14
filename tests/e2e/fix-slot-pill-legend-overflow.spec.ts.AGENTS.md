# fix-slot-pill-legend-overflow.spec.ts — index

Playwright spec (docker harness, opt-in `npm run test:e2e`). Capsule legends at 11 px (`SLOT_PILL_LEGEND`, `-top-2`) and the KB pill's compact stale marker stay INSIDE the pill.

- Sidebar folder card (375/768/1440 × base-dark/base-light/nord-dark): F1 `kbPillStates` capture with `overflowRoot` (contrast/size/focus/overflow all empty, `measured > 0`); F2 stale marker rect ⊂ pill, `19,397` untruncated, count contrast ≥ 4.5:1 via `elementColors` + `contrastRatio`, root accessible name has `3 stale`; F3 legend `bottom ≤` glyph chip + count line at 1 / 2 grid columns; X1 300-char `lastError` stays only in the root `title`.
- Desktop worktree session card (768/1440 only — `useMobile` below 768 renders the mobile card with no KB slot): real git worktree + spawned session in `beforeAll` (as `folder-collapse-worktree.spec.ts`), `/api/kb/stats` stubbed for every cwd. F4 populated → stale, pill overflow empty, reindex control outside the pill; F5 every capsule legend clears the element above and its own panel content; X2 setup failure fails every card row with the recorded `setupError` (never a skip).
- Card addressed by `[data-session-id]`, not `folderCard` (needs a sortable wrapper not every layout renders). Geometry assertions use `expect.poll` (pill settles after the theme reload).
- Manual-only (not here): legend reads as label, not heading (#F6) — human review.

See change: fix-slot-pill-legend-and-stale-overflow.
