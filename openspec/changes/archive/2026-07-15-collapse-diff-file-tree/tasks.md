# Tasks

## 1. Slim the Changes section to a summary bar

- [x] 1.1 In `ChangesRailSection.tsx`, drop `DiffFileTree`; render only `Changes (N) · +X −Y · [☐ this session only]` plus the existing `summed` badge for non-git sessions. Read `sessionOnly` value + setter from props (rail-local, D3). → verify: rail top shows a one-line summary, no file list.
- [x] 1.2 `EditorPane` owns `sessionOnly` (`useState(false)`, ephemeral) and passes it to the summary bar and the bottom group. → verify: toggling in the summary bar updates both consumers; `FileDiffView` takeover unaffected.

## 2. Inline changed-file markers in the workspace tree

- [x] 2.1 In `EditorFileTree.tsx`, consume `useOptionalSessionDiff()`; build a `Map<rel, FileDiffEntry>` over `data.files` (session-owned, on-disk). Direct `rel` match — no `normalizeUnderCwd` retry (D1). → verify: a visible changed file's row resolves its entry.
- [x] 2.2 A changed file row renders a status indicator (`+` added / `●` modified/tool-origin, reusing `DiffFileTree`'s `hasEdits`/origin logic) + `+X −Y` `CountBadges`. → verify: added vs modified vs tool-origin render the intended indicator; counts match.
- [x] 2.3 A directory row whose subtree contains a changed file shows a change dot, derived by path-prefix over the map — no extra fetch (D1). → verify: a collapsed dir containing a changed file shows a dot; one without does not.
- [x] 2.4 Hovering a changed row reveals a `diff` chip that calls `openDiffTab(rel)`; clicking the row name still calls `onOpenFile` (normal viewer). → verify: chip opens a `diff:` tab, name opens the file viewer.
- [x] 2.5 A changed file with `changes.length > 1` gains an expander revealing `✏️/📝` change-event rows. → verify: expander toggles the event rows.

## 3. Residual "not on disk" bottom group

- [x] 3.1 Render a muted, collapsed group at the bottom of the tree's scroll region holding `otherChanges` (flat path list); the `this session only` toggle hides it (D5). Deleted files are out of scope (server skips pure deletions). → verify: an other-change appears at the bottom; `this session only` hides the group.

## 4. Diff tab Preview mode

- [x] 4.1 Add a `Diff / Preview` segment to the diff tab toolbar (alongside the existing `File` mode), component-local state (D4). → verify: toggle switches the body; defaults to Diff; existing `Diff/File` behavior intact (`DiffPanelPreview.test.tsx` still green).
- [x] 4.2 Preview renders context + added lines from `gitDiff` in new-file line order with removed lines omitted (additions tinted). → verify: no `-` lines shown; line numbers are new-file order; unchanged code far from a hunk is absent (changed-regions scope).
- [x] 4.3 When the file has no parseable `gitDiff` (non-git / summed / binary → zero hunks), the `Preview` control is disabled. → verify: such a file cannot enter Preview.

## 5. Tests (folded from test-plan.md — all L1 vitest + RTL)

Exemplars to copy harness glue from: `packages/client/src/components/__tests__/DiffPanelPreview.test.tsx` (diff tab), `.../editor-pane/__tests__/EditorFileTree.test.tsx` (tree), `.../editor-pane/__tests__/ChangesRailSection.test.tsx` (summary bar).

- [x] 5.1 Preview transform (see DiffPanelPreview.test.tsx): input = `gitDiff` one hunk `@@ -18,7 +18,12 @@` with context+`+`+`-`; trigger = select `Preview`; observable = rows are context+added only in new-file order (18…26), zero `-` lines. (test-plan #E1)
- [x] 5.2 Preview disabled (see DiffPanelPreview.test.tsx): input = entry with `gitDiff` undefined OR `"Binary files differ"`; trigger = mount diff tab; observable = `Preview` control disabled, mode stays `diff`. (test-plan #E2)
- [x] 5.3 Status indicator by origin (see EditorFileTree.test.tsx): input = write-only/edit/`origin:"tool"` entries; trigger = render rows; observable = `+` green / `●` yellow / `●` respectively. (test-plan #E3)
- [x] 5.4 Folder dot prefix (see EditorFileTree.test.tsx): input = changed set `[packages/server/src/a.ts]`, dir rows `packages`,`packages/server/src`,`qa`; trigger = render collapsed tree; observable = first two show a dot, `qa` does not. (test-plan #E4)
- [x] 5.5 Summed badge (see ChangesRailSection.test.tsx): input = `data` `isGitRepo:false` with `totalAdditions`; trigger = mount summary bar; observable = `summed` badge shown, no `DiffFileTree` rows. (test-plan #E5)
- [x] 5.6 Summary bar replaces list (see ChangesRailSection.test.tsx): input = 3 changes; trigger = mount rail; observable = `Changes (3) · +X −Y · [this session only]`, query for roll-up/`DiffFileTree` finds nothing. (test-plan #F1)
- [x] 5.7 Row click vs diff chip (see EditorFileTree.test.tsx): input = one visible on-disk changed file; trigger = click name, then click hover `diff` chip; observable = `onOpenFile(rel)` vs `openDiffTab(rel)` called respectively. (test-plan #F2)
- [x] 5.8 Multi-event expander (see EditorFileTree.test.tsx): input = changed file `changes.length===2`; trigger = click expander; observable = two `✏️/📝` rows appear, collapse hides them. (test-plan #F3)
- [x] 5.9 Bottom group other-changes (see EditorFileTree.test.tsx): input = one `otherChanges` entry; trigger = mount; observable = it appears in the muted bottom group; `this session only` hides the group. (test-plan #F4)
- [x] 5.10 Preview default + File coexist (see DiffPanelPreview.test.tsx): input = file with parseable `gitDiff`; trigger = mount diff tab; observable = defaults `Diff`; `File` + `Preview` both present; `File` still fetches `/api/session-file` (existing test green). (test-plan #F5)
- [x] 5.11 openChanges reveals rail only (see EditorPane/ChangesRailSection tests): input = hidden rail; trigger = `openChanges()` bumps `changesRevealSignal`; observable = rail visible, no diff tab opened by openChanges. (test-plan #F6)
- [x] 5.12 No auto-expand (see EditorFileTree.test.tsx): input = changed file in an unexpanded dir; trigger = mount; observable = file row NOT rendered (dir collapsed); folder dot marks it. (test-plan #F7)
- [x] 5.13 Diff data absent (see EditorFileTree.test.tsx): fault = `useOptionalSessionDiff()` returns `null`; trigger = mount tree; observable = tree renders, zero markers, no throw. (test-plan #X1)
- [x] 5.14 Path-map miss (see EditorFileTree.test.tsx): fault = tree `rel` with no matching `data.files` entry; trigger = render row; observable = plain unmarked row, no crash. (test-plan #X2)

## 6. Manual / QA

- [x] 6.1 Visual density / tint (test-plan: manual-only) — eyeball the merged rail + Preview: additions tint legible, rail not cramped, folder dots readable. (test-plan #M1)
- [x] 6.2 Load a session with many changes; confirm one tree with inline markers on visible changed files, folder dots on collapsed ancestors, no 45% Changes box, other-changes in the bottom group. (test-plan: manual-only)
- [x] 6.3 Open a changed file's diff; toggle Preview (changed-regions, removals gone); confirm the separate `File` mode still shows the whole file. (test-plan: manual-only)
- [x] 6.4 Activate a changed-file link in the chat transcript; confirm the rail reveals and the file's diff opens via the unchanged `openDiffTab` path. (test-plan: manual-only)
