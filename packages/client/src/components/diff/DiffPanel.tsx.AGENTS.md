# DiffPanel.tsx — index

Diff renderer for a selected file. Exports `DiffPanel`.
Modes: `diff`, `file`, `preview`.
`diff`: split/unified via `@git-diff-view/react` + `RichDiff`.
`file`: whole current content via `SyntaxHighlighter`, fetched from `/api/session-file`.
`preview`: changed regions of the current file — context+added in new-file line order, removed omitted, additions tinted.
`preview` derives via `buildPreviewLines` from `gitDiff`; disabled when no parseable hunks (non-git/summed/binary); auto-resets to `diff` when a refresh drops support.
Diff data — Path A: change-derived `oldText`/`newText` (`buildChangeDiffTexts`). Path B: git aggregate — `<DiffView data.hunks=[file.gitDiff]>` (whole header-bearing diff). Path C: newest change with renderable texts (`pickFallbackChange`).
Toolbar toggles view mode + diff mode (split/unified).
See change: collapse-diff-file-tree.

See change: fix-empty-git-aggregate-diff-tab — Path B passes the WHOLE `file.gitDiff` (header-bearing) as the single `hunks` element, not `extractHunks(file.gitDiff)`; header-stripped bare hunks + empty file content reconstruct zero lines (empty `diff:` tab). Guard stays `extractHunks(file.gitDiff).length > 0`. `extractHunks` now used only by `buildPreviewLines` (Regions) + that guard. Path C scans changes newest→oldest via `pickFallbackChange`, picks the first with renderable texts (or a `truncated` change), skips detected-on-disk-only `type:"tool"` events; `activeChange` keys off the same change so truncated edits still upgrade.

See change: opt-in-out-of-cwd-session-diffs — hides the File content-view toggle (testid `file-view-toggle`) when `file.previewable === false` (out-of-cwd; /api/session-file would 403). Lazy-fetches the full payload from `GET /api/session-change/:sessionId/:toolCallId` when the active change is `truncated` + has a `toolCallId`, merging full `content`/`edits` over the trimmed event; on fetch failure (or no toolCallId) renders a `diff-truncation-banner` ("Diff too large to show inline" for collapsed edits, else "Content truncated — full version unavailable") + the partial diff (never blank).
