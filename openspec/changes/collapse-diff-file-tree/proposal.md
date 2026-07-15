## Why

The editor-pane rail carries **two** file trees stacked on top of each other:

- `ChangesRailSection` → `DiffFileTree` — the changed files, pinned atop the rail, expanded by default at `maxHeight: 45%`.
- `EditorFileTree` — the lazy workspace tree below it.

The Changes box duplicates the workspace tree's whole job (group files by directory) in a *second* scrollable region, and on a large change it eats ~45% of the rail and pushes the workspace tree far down. Collapsing the Changes section (the original proposal) only hides it behind a click; it does not remove the duplication.

The user wants **one tree**: changed files marked **inline** in the workspace tree, with only a slim `Changes (N)` summary bar retained. Separately, the diff tab should offer a **Preview** mode focused on the changed regions of the current file (removed lines omitted).

## What Changes

- **Remove the changed-file list from the rail.** `ChangesRailSection` shrinks to a slim summary bar: `Changes (N) · +X −Y · [☐ this session only]` (plus the existing `summed` badge for non-git sessions). It no longer renders `DiffFileTree`. (`DiffFileTree` itself stays — the full-screen `FileDiffView` takeover still uses it.)
- **`EditorFileTree` marks session-owned changed files inline.** A changed file row that is currently visible in the tree SHALL show a status indicator (`+` green = added, `●` yellow = modified/tool-origin) and `+X −Y` count badges. Hovering the row reveals a small `diff` chip.
- **Folder change dots.** A directory whose subtree contains a session-owned changed file SHALL show a small change dot on its row — derived from the changed-file path list by prefix match, **no extra directory fetch** — so changes in collapsed directories remain discoverable without auto-expanding the tree.
- **Change-event history inline.** A changed file with more than one recorded change event SHALL gain an expander that reveals its `✏️/📝` per-event rows.
- **Click vs. diff.** Clicking a changed row opens the **normal file viewer** (unchanged behavior); the hover `diff` chip opens the file's `diff:` viewer tab via `openDiffTab`.
- **Other-changes group.** Working-tree changes this session did not make (`otherChanges`) SHALL render as a muted, collapsed group at the **bottom** of the rail's scroll region (rendered as a flat path list, so tree expansion is irrelevant). The `this session only` toggle hides it. (Deleted session-owned files are out of scope: the server skips pure deletions in `session-diff.ts`, so `data.files` never carries a not-on-disk row.)
- **Diff tab Preview mode.** The `diff:` viewer SHALL gain a `Diff / Preview` segmented toggle. **Preview** renders the **changed regions** of the current file — context + added lines from the unified `gitDiff` in new-file line-number order, removed lines omitted, additions subtly tinted. When no `gitDiff` is available (non-git / summed / binary), Preview is disabled and the tab stays Diff-only.
- **Persistence unchanged.** `sessionOnly` and the Diff/Preview mode are ephemeral (reset per mount). Tree expansion (`treeOpenRoots`) keeps its **existing** localStorage persistence — this change adds no new auto-expansion, so it introduces no new persisted state.

### Accepted trade-offs (from doubt-driven review)

- **Preview overlaps the shipped `File` mode.** `DiffPanel` already ships a `Diff / File` toggle where `File` fetches the *whole* current file via `/api/session-file` (change `fix-session-diff-open-nongit-and-preview`). The new `Preview` is a **distinct, diff-derived** view: no server fetch, scoped to changed regions only (it deliberately omits unchanged code far from any hunk). Both modes coexist; the label distinguishes whole-file (`File`) from changed-regions (`Preview`). Accepted per user decision.
- **No auto-expand.** Changed files inside collapsed directories show no inline row until the user expands that directory; the folder change dot + the summary count are the discovery signals. Accepted per user decision (auto-expand was rejected for its reducer/seed/fetch-burst cost).

Out of scope: collapsing the standalone Changes section (superseded — the section is removed); persisting `sessionOnly`/mode; auto-expanding changed-file ancestors; a full side-by-side before/after editor.

## Discipline Skills

- `code-simplification` — the change removes a rendering path (`DiffFileTree` in the rail) and folds markers into `EditorFileTree`; keep the merged row simple, not a second tree grafted on.

## Capabilities

### Modified Capabilities
- `change-summary-table`: changed files are surfaced as **inline markers in the workspace tree** (plus folder dots + a residual bottom group for not-on-disk changes) and a slim summary bar, replacing the standalone `DiffFileTree` rail section; the `diff:` viewer gains a **Preview** mode.

## Impact

- **Code**:
  - `packages/client/src/components/editor-pane/ChangesRailSection.tsx` — reduce to the summary bar (+ `this session only` toggle, `summed` badge); drop `DiffFileTree`.
  - `packages/client/src/components/editor-pane/EditorFileTree.tsx` — consume `useOptionalSessionDiff()`; build `Map<rel, FileDiffEntry>` over session-owned on-disk files; mark rows (status dot, counts, `diff` chip, change-event expansion); folder change dots via path-prefix; render the bottom "not on disk" group.
  - `packages/client/src/components/editor-pane/EditorPane.tsx` — recompose the rail (summary bar → tree → bottom group); own the rail-local `sessionOnly` state and pass it down.
  - `packages/client/src/components/editor-pane/DiffViewer.tsx` (+ `DiffPanel`) — add the `Diff / Preview` toggle and the changed-regions render derived from `gitDiff`; disable Preview when no `gitDiff`.
- **Tests**: `EditorFileTree.test.tsx` (inline markers, folder dots, event expansion, diff chip, other-changes group), `ChangesRailSection.test.tsx` (summary-bar only, no `DiffFileTree`), a Preview-mode test on the diff tab (omits `-` lines; disabled with no `gitDiff`).
- **APIs / protocol**: none — Preview is derived client-side from the existing `gitDiff`.
- **Persistence**: none added (`sessionOnly`/mode ephemeral; `treeOpenRoots` uses existing persistence).
- **Mockup**: `mockups/merged.html` (merged rail + Diff/Preview toggle; the shipped shape).
