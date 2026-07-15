# DiffPanel.tsx — index

Diff renderer for a selected file. Exports `DiffPanel`.
Modes: `diff`, `file`, `preview`.
`diff`: split/unified via `@git-diff-view/react` + `RichDiff`.
`file`: whole current content via `SyntaxHighlighter`, fetched from `/api/session-file`.
`preview`: changed regions of the current file — context+added in new-file line order, removed omitted, additions tinted.
`preview` derives via `buildPreviewLines` from `gitDiff`; disabled when no parseable hunks (non-git/summed/binary); auto-resets to `diff` when a refresh drops support.
Diff data — Path A: change-derived `oldText`/`newText` (`buildChangeDiffTexts`). Path B: git aggregate hunks (`extractHunks`).
Toolbar toggles view mode + diff mode (split/unified).
See change: collapse-diff-file-tree.
