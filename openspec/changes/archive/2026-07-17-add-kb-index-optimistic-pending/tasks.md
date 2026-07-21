# Tasks

## 1. Hook — optimistic `pending` in `useKbStats`
- [x] 1.1 In `packages/kb-plugin/src/client/__tests__/`, add a `useKbStats` test: call `reindex()`; assert `pending` is `true` synchronously (before the mocked `reindexKb`/`fetchKbStats` promises resolve). → verify: fails today (`pending` does not exist).
- [x] 1.2 Add a handoff test: `reindexKb`→`202`, then `fetchKbStats`→`indexing:true`; assert `pending` clears to `false` once a poll observes `indexing:true` and `stats.indexing` is `true` (no gap where both are false). → verify: fails today.
- [x] 1.3 Add a reject test: `reindexKb`→reject(`403`); assert `pending` clears to `false` AND `reindexError` is set. → verify: fails today.
- [x] 1.4 Add a timeout-guard test: `reindexKb`→`202` but `fetchKbStats` always reports `indexing:false`; advance timers past the guard; assert `pending` clears and a `refetch` runs (fresh stats). → verify: fails today (pending would never clear).
- [x] 1.5 `useKbStats.ts`: add `pending: boolean` to `UseKbStatsResult`; set `pending=true` synchronously at the top of `reindex()`; clear it (a) in the `.catch` alongside `setReindexError`, (b) inside the `/stats` load when `s.indexing === true` is observed, (c) via a bounded timeout guard armed on `reindex()` that clears `pending` + `refetch()`s if neither (a) nor (b) fired. Ensure the guard is cleared on unmount and on definitive clear. → verify: 1.1–1.4 pass; existing `useKbStats` tests stay green.

## 2. Component — render pending as `indexing` + disable the button
- [x] 2.1 In `packages/kb-plugin/src/client/__tests__/`, add a `FolderKbSection` synchronous-spinner test: mock a not-indexed folder; click `Index now`; assert the animated indicator (`animate-spin`) is present in the render before any `/stats` promise resolves. → verify: fails today (button stays "Index now" through two round-trips).
- [x] 2.2 Add a disabled-during-pending test: click `Index now`; assert the action control is `disabled`; a second click fires no second `reindexKb`. → verify: fails today.
- [x] 2.3 Add a no-flicker handoff test: `202` then `/stats` `indexing:true`→`populated`; assert the spinner is continuous (never reverts to `Index now`) and lands on the chunk count. → verify: fails today.
- [x] 2.4 `FolderKbSection.tsx`: destructure `pending` from `useKbStats`; derive `state` as `clientError ? "error" : pending ? "indexing" : deriveKbRowState(stats)` (error still outranks pending); compute `busy = pending || stats?.indexing === true` and set `disabled={busy}` + non-interactive styling on the reindex / `Index now` / reindex-icon controls. Reuse the existing `indexing` spinner branch verbatim. → verify: 2.1–2.3 pass; existing `FolderKbSection` tests green.

## 3. Regression + validation
- [x] 3.1 Run the kb-plugin client suite scoped (`npm test` for the plugin) — all client tests green, no act() warnings, no leaked timers. → verify: exit 0.
- [x] 3.2 `openspec validate add-kb-index-optimistic-pending --strict` passes. → verify: no errors.
- [x] 3.3 Manual (running dashboard): on a not-indexed folder card, `Index now` shows the spinner instantly on click and the button is disabled; the spinner stays continuous into the real walk and lands on the chunk count; a forced `403` (unknown cwd) clears the spinner into `error`+`Retry`. → verify: all observed.

## 4. Docs + type drift
- [x] 4.1 Update per-file `AGENTS.md` rows for `useKbStats.ts` and `FolderKbSection.tsx` (`packages/kb-plugin/src/client/AGENTS.md`) to note optimistic `pending` (spinner on click, button disabled, clears on reject / real-indexing / timeout guard). Add `See change: add-kb-index-optimistic-pending`. → verify: `kb dox lint` clean.
