## Why

Clicking a file in the ChatView change-list opens a `diff:` tab that renders **empty** for git-tracked files, while the same file's **File** view and its inline chat change-card both render correctly.

Root cause (verified against `@git-diff-view/core` v0.1.6):

- The `diff:` tab is rendered by `DiffViewer`, which passes `selection={{ changeIndex: null }}`. With no selected change, `DiffPanel` skips its change-derived **Path A** and — because the file is git-tracked with a non-empty `file.gitDiff` — takes the **git-aggregate Path B**: `<DiffView data={{ oldFile:{content:""}, newFile:{content:""}, hunks }}/>`.
- Path B builds `hunks` via `extractHunks(file.gitDiff)`, which **strips the unified-diff file header** (`diff --git …`, `index …`, `--- a/…`, `+++ b/…`) and keeps only the `@@…`-onward hunk bodies.
- `@git-diff-view` reconstructs the view from `hunks` **only when each hunk string still carries the file header**. Given bare `@@…` bodies with empty file content, it produces **zero diff lines** → an empty panel.

Proof (real library):

```
[bare @@ hunk       + empty content] → unified=0 split=0   ← what Path B feeds (BUG)
[full diff w/ header + empty content] → unified=8 split=8   ← header kept → renders
[whole 2-hunk diff, 1 array element ] → unified=7 split=6   ← header kept → renders
```

This is not a `@git-diff-view` regression: the library needs either real file content or a header-bearing diff, and Path B supplies neither. The inline chat change-card is unaffected because it uses `<RichDiff>` with real `oldText`/`newText`.

## What Changes

- **Fix `DiffPanel` git-aggregate Path B (`packages/client/src/components/DiffPanel.tsx`):** feed `<DiffView>`'s `data.hunks` a **header-preserving** diff so `@git-diff-view` can reconstruct lines from empty file content. `file.gitDiff` is already a complete unified diff with its `diff --git`/`---`/`+++` header, so pass it whole (`hunks: [file.gitDiff]`) instead of the header-stripped `extractHunks(file.gitDiff)` output. The rendering component (`<DiffView>` via the `data` prop) is UNCHANGED — only the `hunks` payload is corrected. `extractHunks` remains in use by `buildPreviewLines` (Preview mode), which is unaffected.
- **Close the secondary Path C gap:** when a file has no `gitDiff` and its last change is a detected-on-disk-only event (`type:"tool"`), `buildChangeDiffTexts` returns `null`, also yielding an empty panel. Path C SHALL fall back to the file's most recent change that DOES carry renderable texts (an `edit` with `edits[]` or a `write` with `content`), and only when none exists render the existing "No diff data available" note.

## Capabilities

### Modified Capabilities
- `tool-renderers`: the git-aggregate-diff path of `DiffPanel` SHALL render non-empty diff content for git-tracked files by passing `<DiffView>` a header-bearing `hunks` payload; the change-derived fallback SHALL prefer the most-recent change with renderable texts over a detected-on-disk-only event.

## Discipline Skills

- `systematic-debugging` — root-caused via evidence (isolated `@git-diff-view` reproduction), not a guessed fix.
- `review-code` — inline review of the `DiffPanel` diff before commit.

## Impact

- **Code:** `packages/client/src/components/DiffPanel.tsx` (Path B `hunks` payload; Path C fallback selection). Client change → `npm run build` + restart in production mode; Vite HMR in dev.
- **Tests:** the existing `DiffPanel*` tests mock `@git-diff-view/react`, so they never exercised real reconstruction and did not catch this. Add a test that asserts Path B passes a header-bearing `hunks` payload (and/or an integration test using the real library) so the empty-diff regression is guarded.
- **Docs / tree:** update `packages/client/src/components/DiffPanel.tsx.AGENTS.md` row to record the header-preserving git-aggregate payload + the Path C fallback (`See change: fix-empty-git-aggregate-diff-tab`).
- **Out of scope:** any change to `RichDiff`, the change-derived Path A, Preview mode, the File view, or the server `session-diff` enrichment. `@git-diff-view` is not upgraded.
