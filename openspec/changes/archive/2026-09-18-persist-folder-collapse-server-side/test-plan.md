# Test Plan — persist-folder-collapse-server-side

Stage: design   Generated: 2026-02-17

All clarifications resolved before writing (HARD gate): migration backstop = 10
loads; no latency budget (functional convergence only, no perf scenario);
unbounded-growth ceiling asserted at 1,000 entries.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | global-preferences · collapsedFolders persisted | state-transition | L1 | automated | `preferences.json` with no `collapsedFolders` field | store loads the file | load succeeds; `getCollapsedFolders()` returns `[]`; no throw |
| E2 | global-preferences · collapsedFolders persisted | decision-table | L1 | automated | empty store | `setFolderCollapsed("/repo/a", true)` | returns `true`; array contains exactly `["/repo/a"]` |
| E3 | global-preferences · collapsedFolders persisted | decision-table | L1 | automated | store holding `/repo/a` | `setFolderCollapsed("/repo/a", true)` again | returns `false`; array unchanged; **no broadcast emitted** |
| E4 | global-preferences · collapsedFolders persisted | decision-table | L1 | automated | store holding `/repo/a` | `setFolderCollapsed("/repo/a", false)` | returns `true`; array is `[]` |
| E5 | global-preferences · collapsedFolders persisted | decision-table | L1 | automated | empty store | `setFolderCollapsed("/repo/a", false)` | returns `false`; no broadcast |
| E6 | collapsible-groups · Canonical folder collapse keys | EP | L1 | automated | store holding `/repo/a` | lookup for `/repo/a/` (trailing separator) | recognised as collapsed |
| E7 | collapsible-groups · Canonical folder collapse keys | EP | L1 | automated | store holding `C:\repo\a` on win32 | lookup for `c:/repo/a` (case + separator style) | recognised as collapsed |
| E8 | collapsible-groups · Canonical folder collapse keys | EP (negative) | L1 | automated | store holding `/repo/a` on a POSIX host | lookup for `/repo/A` | NOT recognised as collapsed (case folding is Windows-only — guards against re-introducing `process.platform`) |
| E9 | collapsible-groups · Canonical folder collapse keys | state-transition | L1 | automated | folder collapsed via `/repo/a` | expand issued via `/repo/a/` | exactly one entry affected; folder renders expanded |
| E10 | global-preferences · paths stored as given | EP | L1 | automated | `/tmp/x` where `/tmp` is a symlink to `/private/tmp` | store + read back | stored value is `/tmp/x`, NOT `/private/tmp/x` (unlike `pinnedDirectories`) |
| E11 | global-preferences · collapsedFolders persisted | BVA (volume) | L1 | automated | `preferences.json` carrying 1,000 collapsed entries (~80KB) | server start + `getCollapsedFolders()` | all 1,000 load; lookup for a known key returns collapsed; no truncation |
| E12 | collapsible-groups · Server-side persistence | state-transition | L1 | automated | store holding a persisted entry | debounced write flushed, store re-read from disk | entry survives the restart round-trip (guards the two `writeJsonFile` literals at `preferences-store.ts:379`/`:391`) |
| E13 | collapsible-groups · Server-side persistence (no prune) | state-transition | L1 | automated | store holding `/repo/main` (a worktree main path no session reports as its cwd) | session list changes: spawn, then archive | entry still present after both changes |

### Performance

None. Per Q2 the collapse round-trip has no latency budget; convergence is
covered functionally by F1/F5 instead. The only volume concern (unbounded
`collapsedFolders`) is asserted as a correctness scenario at E11 rather than a
timed one.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | collapsible-groups · Server-side persistence | state-convergence | L3 | automated | dashboard with ≥2 folder groups | collapse a folder, reload the page | converges to: that folder collapsed, others expanded — with no intermediate frame showing it expanded |
| F2 | collapsible-groups · State available on first paint | state-convergence | L3 | automated | server holding a collapsed folder | fresh client connect | `collapsed_folders_updated` arrives before `sessions_snapshot`; folder never renders expanded-then-corrects |
| F3 | collapsible-groups · Server-side persistence | state-convergence | L3 | automated | two browser contexts on one dashboard | collapse a folder in context A | context B converges to collapsed without a reload |
| F4 | collapsible-groups · Canonical keys (worktree) | state-transition | L3 | automated | a session in `.worktrees/feat-x` grouped under its main path | collapse that group, reload | group renders collapsed (the exact leak that motivated the change) |
| F5 | session-card-seek · Scroll waits for layout | state-convergence | L3 | automated | target card inside a collapsed folder | activate Seek | scroll fires when the collapsed-folders echo lands, NOT at the backstop timeout; no Retry toast |
| F6 | session-card-seek · Ancestor chain (add-only) | state-transition (illegal edge) | L3 | automated | collapsed folder ancestor | activate Seek twice, the second before the first echo lands | folder ends expanded; never re-collapses (the toggle-inversion race) |
| F7 | session-card-seek · Ancestor chain (resolved path) | state-transition | L3 | automated | active session in a worktree, group rendered under the main path | activate Seek | the rendered group expands (not a key no group owns) |
| F8 | collapsible-groups · Expanding to spawn | state-transition (illegal edge) | L3 | automated | collapsed folder | click `+ Session` twice, the second before the first echo | folder ends expanded; not re-collapsed by the second click |
| F9 | collapsible-groups · Server-side persistence (zero-session folders) | state-transition | L3 | automated | a pinned directory with no sessions, collapsed | spawn a session elsewhere, then reload | pinned folder still collapsed (Leak B) |
| F10 | collapsible-groups · default state unchanged | EP | L1 | automated | folder with no stored entry | first render | renders expanded (guards the untouched default through the storage move) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | collapsible-groups · One-shot migration | fault-injection (abort) | L1 | automated | connection drops before any echo confirms | migration runs with a legacy value present | `dashboard:collapsedGroups` is RETAINED; attempt counter incremented; retried next load |
| X2 | collapsible-groups · One-shot migration | state-transition | L1 | automated | legacy value present; server already holds every legacy key | migration runs after the connect snapshot | sends NOTHING (no no-op mutation → no missing echo → no hang); removes the legacy key immediately |
| X3 | collapsible-groups · One-shot migration | BVA | L1 | automated | legacy value that never gets confirmed; attempt counter at 9 | 10th load | legacy key dropped regardless; logged once; no 11th send |
| X4 | collapsible-groups · One-shot migration | EP | L1 | automated | legacy value holding `/repo/a` and `/repo/a/` | migration runs | deduplicates to one key; one message sent |
| X5 | collapsible-groups · One-shot migration | state-transition | L1 | automated | legacy value present; server holds a folder the legacy set does NOT contain | migration runs | server's folder is preserved (union, not overwrite) |
| X6 | collapsible-groups · One-shot migration | state-transition | L1 | automated | migration already completed (no legacy key) | page reloads | no messages sent; no-op |
| X7 | global-preferences · broadcast + frame class | fault-injection (buffer pressure) | L1 | automated | browser send-buffer saturated | `collapsed_folders_updated` emitted | classified `cls: "state"` and coalesced by type — NOT shed as a `transcript` frame |
| X8 | global-preferences · collapsedFolders persisted | fault-injection (corrupt input) | L1 | automated | `preferences.json` where `collapsedFolders` is a string, not an array | server start | falls back to `[]`; rest of the file still loads; no crash |

---

## Coverage summary

- Requirements covered: 8/8 (3 delta specs — collapsible-groups ×2,
  global-preferences ×1, session-card-seek ×2, plus the untouched-default and
  no-prune invariants)
- Scenarios by class: edge 13 · perf 0 · frontend 10 · error 8
- Scenarios by level: L1 21 · L2 0 · L3 10
- Scenarios by disposition: automated 31 · manual-only 0

## New infra needed

None. E*/X* extend existing vitest suites (`preferences-store` tests,
`session-filter-storage.test.ts`, `SessionList.test.ts`); F* extend the existing
Playwright harness (`tests/e2e/`), whose dashboard port is read from
`.pi-test-harness.json` rather than hardcoded.
