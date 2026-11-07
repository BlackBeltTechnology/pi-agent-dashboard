# Test Plan: fix-archive-fold-key-and-filter-chips

Stage: design   Generated: 2026-11-06

Darwin and win32 behaviour cannot be reproduced in the Linux docker harness. Those cases run at L1 with the platform injected, through `createSessionArchive({ platform })` on the server and `pathKeyPlatform` on the client. L3 covers the Linux path and the rendered funnel.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | archived-session-listing: Per-folder count (snapshot names key platform) | EP (platform partition) | L1 | automated | gateway with `sessionArchive` built with `platform: "darwin"`, 2 archived rows `cwd=/Users/x/Proj` | browser connects | `sessions_snapshot.pathKeyPlatform === "darwin"` and `archivedCountByCwd` equals `{ "/users/x/proj": 2 }` |
| E2 | archived-session-listing: Per-folder count | EP (platform partition) | L1 | automated | same as E1 but `platform: "linux"` | browser connects | `pathKeyPlatform === "linux"` and `archivedCountByCwd` equals `{ "/Users/x/Proj": 2 }` |
| E3 | archived-session-listing: Fold visible for mixed-case folder | decision table (platform x spelling) | L1 | automated | SessionList with `archiveKeyPlatform="darwin"`, `archivedCountMap={"/users/x/proj":82}`, a live session `cwd=/Users/x/Proj` | render | `folder-archive-toggle-/Users/x/Proj` is present with text `Archive (82)` |
| E4 | archived-session-listing: Fold visible for pinned folder spelled differently | decision table | L1 | automated | `archiveKeyPlatform="darwin"`, `pinnedDirectories=["/Users/x/Proj/"]`, no live sessions, `archivedCountMap={"/users/x/proj":3}` | render | the pinned group shows `Archive (3)` |
| E5 | archived-session-listing: Linux keeps case-distinct folders apart | decision table | L1 | automated | `archiveKeyPlatform="linux"`, live sessions in `/a/Proj` and `/a/proj`, `archivedCountMap={"/a/Proj":2,"/a/proj":5}` | render | the two folds read `Archive (2)` and `Archive (5)` respectively |
| E6 | archived-session-listing: Older server without the platform field | EP (absent field) | L1 | automated | `archiveKeyPlatform` undefined, live session `/a/b`, `archivedCountMap={"/a/b":4}` | render | `Archive (4)` shown (inferred-linux fallback) |
| E7 | archived-session-listing: Fold first expand fetches the folder archive key | state-transition (collapsed to expanded) | L1 | automated | `archiveKeyPlatform="darwin"`, live `/Users/x/Proj`, count 82, `fetch` mocked | click `folder-archive-toggle-/Users/x/Proj` | exactly one request with `cwd=/users/x/proj&limit=50`; skeleton rows render until it resolves, then archived rows render |
| E8 | archived-session-listing: Archive matches attach to a mixed-case folder | decision table | L1 | automated | `archiveKeyPlatform="darwin"`, Archived toggle on, query `proj-notes`, live group `/Users/x/Proj`, mocked `q` response with one item `groupPath=/Users/x/proj` | debounce settles | that group shows `Archive matches (1)`, and the folder stays visible with no resident match |
| E9 | archived-session-listing: listing endpoint resolves folded cwd | EP (spelling) | L1 | automated | `createSessionArchive({platform:"darwin"})` seeded with 3 rows `cwd=/Users/x/Proj` | `list({cwd:"/users/x/proj"})` and `list({cwd:"/Users/x/Proj/"})` | both return the same 3 ids |
| E10 | session-listing: Snapshot replaces the archive key platform | state-transition | L1 | automated | handler state `pathKeyPlatform="darwin"` | `sessions_snapshot` without `pathKeyPlatform` | setter called with `undefined` |
| E11 | session-listing: Snapshot replaces the archive key platform | state-transition | L1 | automated | handler state undefined | `sessions_snapshot { pathKeyPlatform: "win32" }` | setter called with `"win32"` |
| E12 | session-filtering: Funnel toggles share one style | decision table (on/off x toggle) | L1 | automated | SessionList, funnel opened | render, then click each toggle | both buttons contain an `svg` icon and labels `Archived` and `Hidden`; while on, `aria-pressed="true"` and a check icon (`data-testid` suffix `-check`) is present; while off, the check is absent; the badge counts 0, then 1, then 2 |
| E13 | session-filtering: scope toggles unchanged | EP | L1 | automated | SessionList | render | `search-scope-sessions` and `search-scope-folders` contain no `svg` and no check element |
| E14 | theme-system: pill surfaces use tokens only | static scan | L1 | automated | `SessionList.tsx` after D2 | run `card-pill-surfaces-no-literals.test.ts` with three anchors (ToggleButton, renderAddToWorkspaceButton, folder-pinned-indicator-) | all anchors found and zero colour-literal hits |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | archived-session-listing: Invalidation reaches a mixed-case folder | state-transition (loaded to invalidated) | L1 | automated | `archiveKeyPlatform="darwin"`, live `/Users/x/Proj`, fold expanded with page 1 loaded, count 82 | rerender with `archivedCountMap={"/users/x/proj":81}` | a second first-page request for `cwd=/users/x/proj` fires and the label converges to `Archive (81)` |
| F2 | archived-session-listing: Collapse and re-expand under a folded key | state-transition | L1 | automated | as F1 with page loaded | collapse then re-expand with no count change | no new request, and rows render immediately |
| F3 | design: case-variant live groups share one key | state-convergence | L1 | automated | `archiveKeyPlatform="darwin"`, live sessions in `/Users/x/Proj` and `/users/x/proj`, count 5 under `/users/x/proj` | expand the first group's fold | both groups show `Archive (5)`; one request is issued; both folds report `aria-expanded="true"` |
| F4 | archived-session-listing: Fold loads lazily (Linux, rendered) | state-transition | L3 | automated | docker harness, archived sidecars seeded in a folder with mixed-case path `/root/ws/MixedCase` | open dashboard, expand `Archive (N)` | the fold shows `Archive (N)`, expanding lists N rows, restoring one converges the label to `Archive (N-1)` |
| F5 | session-filtering + archived-session-listing: funnel rendered | state-transition | L3 | automated | docker harness dashboard | click `filter-funnel-btn`, toggle `search-include-archive` | the two popover buttons have equal bounding-box width (+/-1px); the Archived button text is `Archived`; after toggling, the check icon is visible and the badge shows `1`; after reload, the toggle is still on |
| F6 | session-filtering: visual match of the mockup | visual/subjective | — | manual-only | macOS dashboard against `mockups/filter-funnel-chips` option A | human opens the funnel in each theme | [judgment: chips look like one family in all themes, and the check is legible] |
| F7 | archived-session-listing: real macOS fold | hardware/OS (no darwin harness) | — | manual-only | real macOS host with mixed-case archived sessions | restart server, open dashboard | [judgment: every folder with archived sessions shows `Archive (N)` and expands; no darwin CI harness exists] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | archived-session-listing: Fetch failure under a folded key | fault-injection (abort) | L1 | automated | first-page `fetch` rejects for `cwd=/users/x/proj` | expand the fold with `archiveKeyPlatform="darwin"` | inline retry control shown and no skeletons; clicking retry issues the same folded-key request |
| X2 | session-listing: server switch clears the platform | state-transition (host switch) | L1 | automated | App state `pathKeyPlatform="darwin"` | `clearInMemoryState` (server switch) | state is `undefined` before the next snapshot |

---

## Coverage summary

- Requirements covered: 7/7. archived-session-listing covers 3 modified requirements. session-listing, session-filtering and theme-system cover 1 each. The design's invariants (one key, case-variant groups) are also covered.
- Scenarios by class: edge 14, frontend 7, error 2, perf 0. No latency budget is involved: key folding is O(1) per group.
- Scenarios by level: L1 19, L3 2, manual 2.
- Scenarios by disposition: automated 21, manual-only 2.

## New infra needed

- None. The L1 suites exist: `browser-gateway-snapshot-on-connect.test.ts`, `session-archive-index.test.ts`, `useMessageHandler.snapshot-replace.test.tsx`, `SessionList.folder-visibility.test.tsx`, `SessionList.header-declutter.test.tsx`, `card-pill-surfaces-no-literals.test.ts`. The L3 suite exists: `tests/e2e/archive-fold.spec.ts`.
