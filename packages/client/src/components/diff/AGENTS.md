# DOX — packages/client/src/components/diff

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `ChangeSummaryBlock.tsx` | Per-turn change-summary block in chat stream. Collapses to `N files · +X −Y`. Gated on `displayPrefs.changeSummaryTable`. Deltas via `buildTurnSummaries`. See change: add-change-summary-table. |
| `DiffFilePreview.tsx` | Inline file-preview panel for a diff row (rendered by `DiffPanel`): fetches + renders the file via `CappedViewer`. See change: open-view-command-in-editor-pane, fold-oversized-agents-directories. |
| `DiffFileTree.tsx` | Two-level file tree of changed files. Exports `DiffFileTree`, `FileSelection`. → see `DiffFileTree.tsx.AGENTS.md` |
| `DiffPanel.tsx` | Diff renderer for a selected file. Exports `DiffPanel`. Modes: `diff` (split/unified via… → see `DiffPanel.tsx.AGENTS.md` |
| `DiffView.tsx` | Minimal line-by-line unified-diff renderer. Exports `DiffView`. Colors `+` lines green, `-` lines red, `@@` hunk headers blue. No syntax highlighting. |
| `DraggableChangeRow.tsx` | dnd-kit draggable wrapper for OpenSpec change rows. Exports `DraggableChangeRow`. → see `DraggableChangeRow.tsx.AGENTS.md` |
| `FileDiffView.tsx` | Split-pane session-diff view replacing `ChatView`. Left `DiffFileTree`, right `DiffPanel`; auto-selects first… → see `FileDiffView.tsx.AGENTS.md` |
| `RichDiff.tsx` | Pure rich-diff rendering primitive over `@git-diff-view/react` + lowlight. → see `RichDiff.tsx.AGENTS.md` |
| `SessionDiffContext.tsx` | `SessionDiffProvider` — one `useSessionDiff` per session, shared by rail/diff-tab/takeover; refreshes on edit signal. See change: add-change-summary-table. |
