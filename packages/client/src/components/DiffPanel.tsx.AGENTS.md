# DiffPanel.tsx — index

Diff renderer for selected file. Exports `DiffPanel`. Modes: `diff` (split/unified via `@git-diff-view/react` + `RichDiff`) and `file` (`SyntaxHighlighter` + `/api/session-file`). Path A: change-derived `oldText`/`newText`. Path B: complete unified `gitDiff` in `hunks:[gitDiff]`; headers required by parser. See change: fix-session-diff-open-nongit-and-preview.
