# Test Plan — collapse-diff-file-tree

Stage: design   Generated: 2026-07-15

No clarifications outstanding — spec gaps were resolved during doubt-driven review (Preview scope, deleted-file handling, no-auto-expand, rail-local sessionOnly).

Harness note: these components are tested at **L1 (vitest + React Testing Library, jsdom)** per existing repo convention — exemplars `packages/client/src/components/editor-pane/__tests__/EditorFileTree.test.tsx`, `.../__tests__/ChangesRailSection.test.tsx`, `packages/client/src/components/__tests__/DiffPanelPreview.test.tsx`. No new Playwright/e2e level needed.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Preview transform | BVA / pure-fn | L1 | automated | `gitDiff` with one hunk `@@ -18,7 +18,12 @@` containing context+`+`+`-` lines | render diff tab, select `Preview` | rendered rows = context+added only, in new-file line order (18,19,20,21,22,23,24,25,26); zero `-` lines present |
| E2 | Preview disabled without parseable gitDiff | decision-table | L1 | automated | file entry with `gitDiff` undefined (non-git/summed) OR `"Binary files differ"` (0 hunks) | mount diff tab | `Preview` control disabled; mode stays `diff` |
| E3 | Status indicator by origin | decision-table | L1 | automated | three file entries: `write`-only (added), `edit` (modified), `origin:"tool"` no edit | render tree rows | added→`+` green, modified→`●` yellow, tool→`●` |
| E4 | Folder dot prefix logic | EP / pure-fn | L1 | automated | changed set `["packages/server/src/a.ts"]`, tree dir rows `packages`, `packages/server/src`, `qa` | render collapsed tree | `packages` and `packages/server/src` rows show a change dot; `qa` does not |
| E5 | Summed badge on non-git summary | decision-table | L1 | automated | diff `data` with `isGitRepo:false`, `totalAdditions` defined | mount `ChangesRailSection` | summary bar renders `summed` badge; no `DiffFileTree` rows present |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Summary bar replaces list | state-pure | L1 | automated | session with 3 changes | mount rail | rail shows `Changes (3) · +X −Y · [this session only]`; query for `DiffFileTree`/roll-up returns nothing |
| F2 | Row click vs diff chip | decision-table | L1 | automated | one on-disk changed file visible in tree | click row name; then hover+click `diff` chip | name → `onOpenFile(rel)` called; chip → `openDiffTab(rel)` called |
| F3 | Multi-event expander | state-transition | L1 | automated | changed file with `changes.length === 2` | click the row expander | two `✏️/📝` event rows appear; collapse hides them |
| F4 | Bottom group: other-changes | state-pure | L1 | automated | one `otherChanges` entry | mount tree | it appears in the muted collapsed bottom group; toggling `this session only` hides the group |
| F5 | Preview default + File coexist | state-transition | L1 | automated | file with parseable `gitDiff` | mount diff tab | defaults to `Diff`; `File` and `Preview` are both present; selecting `File` still fetches `/api/session-file` (existing `DiffPanelPreview.test.tsx` stays green) |
| F6 | openChanges reveals rail only | state-transition | L1 | automated | collapsed/hidden rail | bump `changesRevealSignal` via `openChanges()` | rail becomes visible; no diff tab is opened by `openChanges` itself |
| F7 | No auto-expand | state-pure | L1 | automated | changed file inside an unexpanded dir | mount tree | the file's own row is NOT rendered (dir stays collapsed); only the folder dot marks it |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Diff data absent | fault-injection | L1 | automated | `useOptionalSessionDiff()` returns `null` (no provider) | mount `EditorFileTree` | tree renders normally with zero markers; no throw |
| X2 | Path-map miss | fault-injection | L1 | automated | a tree file `rel` with no matching `data.files` entry | render row | row renders as a plain (unmarked) file; no marker, no crash |

### Manual-only

| id | requirement | technique | level | disposition | surface | human check | note |
|----|-------------|-----------|-------|-------------|---------|-------------|------|
| M1 | Visual density / tint | visual/subjective | — | manual-only | merged rail + Preview | operator eyeballs | additions tint is legible, rail not cramped, folder dots readable — "looks right" (no automatable observable) |

---

## Coverage summary

- Requirements covered: 8/8
- Scenarios by class: edge 5 · perf 0 · frontend 7 · error 2 · manual 1
- Scenarios by level: L1 14 · L2 0 · L3 0
- Scenarios by disposition: automated 14 · manual-only 1

## New infra needed

- none (all fold into existing vitest component suites)
