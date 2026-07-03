# DiffPanel.tsx — index

Diff renderer for a selected file. Exports `DiffPanel`. Modes: `diff` (split/unified via `@git-diff-view/react` + `RichDiff`) and `file` (full content via `SyntaxHighlighter`, fetched from `/api/session-file`). Path A: change-derived `oldText`/`newText` (`buildChangeDiffTexts`). Path B: git aggregate hunks (`extractHunks`). Toolbar toggles view + diff mode.
