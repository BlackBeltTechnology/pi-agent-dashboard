## MODIFIED Requirements

### Requirement: DiffPanel consumes RichDiff for change-derived diffs
`DiffPanel` SHALL delegate its **change-derived** diff rendering (Edit changes, Write changes, and the most-recent-change fallback — i.e., paths that build a `DiffFile` via `generateDiffFile`) to the shared `<RichDiff>` component. The split↔unified toggle, view-mode toggle (diff/file), file-metadata header, expand controls, and per-change-type dispatch logic SHALL remain in `DiffPanel`. The user-visible behavior of `DiffPanel` (and therefore of `FileDiffView`) SHALL be unchanged by this delegation.

The **git-aggregate-diff path** of `DiffPanel` (the branch that consumes the raw `data` prop of `<DiffView>` with `{ oldFile, newFile, hunks }` derived from `file.gitDiff`) is OUT OF SCOPE for this delegation and SHALL continue to render `<DiffView>` inline within `DiffPanel`. This is intentional: `<RichDiff>`'s API is narrowly scoped to `(oldText, newText, filePath)` and does not accept the raw hunks shape.

The git-aggregate path SHALL supply `<DiffView>`'s `data.hunks` a **header-preserving** unified diff — i.e. a diff string that retains its `diff --git`/`---`/`+++` file header — so that `@git-diff-view` reconstructs diff lines when the `data.oldFile`/`data.newFile` `content` fields are empty. Because `file.gitDiff` is already a complete header-bearing unified diff for the file, `DiffPanel` SHALL pass it whole and SHALL NOT strip its file header before handing it to `<DiffView>`. Rendering a non-empty `file.gitDiff` through this path SHALL produce a non-empty diff view (at least one rendered diff line).

The change-derived fallback (the branch used when no specific change is selected and no `file.gitDiff` is present) SHALL select the file's most recent change whose payload yields renderable texts (an `edit` with a non-empty `edits[]`, or a `write` with `content`), scanning newest-to-oldest; a detected-on-disk-only change (`type:"tool"`, which yields no texts) SHALL be skipped rather than rendered as an empty panel. The "No diff data available" note SHALL appear only when neither a git-aggregate diff nor any renderable change exists.

#### Scenario: DiffPanel split toggle still works for change-derived diffs
- **WHEN** the user toggles `DiffPanel`'s mode control from unified to split for a change-derived diff (Edit or Write)
- **THEN** the underlying `<RichDiff>` SHALL re-render with `mode="split"` and the diff SHALL be displayed side-by-side

#### Scenario: DiffPanel preserves toolbar and file header
- **WHEN** `DiffPanel` renders any diff (change-derived OR git-aggregate)
- **THEN** the toolbar, file-path header, view-mode toggle, and expand controls SHALL be visible exactly as before this change

#### Scenario: Git-aggregate diff path remains inline
- **WHEN** `DiffPanel` renders a file whose diff is sourced from `file.gitDiff` (no specific change selected, no change-derived `DiffFile` built)
- **THEN** `<DiffView>` SHALL be rendered inline within `DiffPanel` using the `data` prop — NOT through `<RichDiff>`

#### Scenario: Git-aggregate diff renders non-empty for a git-tracked file
- **WHEN** `DiffPanel` renders a file whose `file.gitDiff` is a non-empty unified diff and no specific change is selected (e.g. a `diff:` tab opened from the change-list, `selection.changeIndex === null`)
- **THEN** the `hunks` payload handed to `<DiffView>`'s `data` prop SHALL retain the diff's `diff --git`/`+++` file header, and the rendered diff view SHALL contain at least one diff line (SHALL NOT be empty)

#### Scenario: Fallback skips a detected-on-disk-only change
- **WHEN** `DiffPanel` has no selected change and no `file.gitDiff`, and `file.changes` ends with a `type:"tool"` (detected-on-disk-only) event preceded by an `edit` or `write` event on the same file
- **THEN** `DiffPanel` SHALL render the diff of that earlier `edit`/`write` change and SHALL NOT show the "No diff data available" note
