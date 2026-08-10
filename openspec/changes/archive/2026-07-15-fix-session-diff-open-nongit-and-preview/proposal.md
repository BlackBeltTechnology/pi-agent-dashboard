# Fix session-diff open, non-git fallback, and file preview

## Why

Clicking a file row in the per-turn `ChangeSummaryBlock` (the "N files · +X" block in
chat) opens a `diff:` tab that renders **"No changes for this file"** for newly written
files. The additive diff is never shown even though the summary row correctly displays
`+93` etc.

Root cause is a **path-format mismatch**, not git:

- `lib/lineDelta.ts::toolPath()` returns `args.path` **verbatim**. When a Write/Edit tool
  call recorded an **absolute** path (common), the summary row and `openDiffTab(path)`
  carry an absolute path.
- The server's session-diff endpoint normalizes every path to **relative-to-cwd, posix**
  (`session-diff.ts::normalizePath`). `data.files` is keyed by relative paths.
- `DiffViewer` does an exact-string `data.files.find(f => f.path === relPath)`. Absolute
  never equals relative → miss → the panel blanks.

Two secondary gaps compound it:

- The non-git path is implicit: `enrichWithGitDiff` returns files with no `gitDiff` for
  non-git dirs, and the renderer's session-derived fallback is undocumented and only fires
  when the file is found (which it isn't, per above).
- File preview exists as a `Diff / File` toggle inside `DiffPanel` but is not surfaced as
  a first-class affordance in the split diff tab.

## What Changes

1. **Path normalization at the source.** Every changed-file path that is absolute AND
   under the session cwd SHALL be rewritten to relative-posix before it is displayed or
   used to open a diff, so the client agrees with the server's `data.files` keys. Paths
   already relative, or absolute-outside-cwd, are unchanged.

2. **git ⇒ gitDiff, else session-derived diff (explicit contract).** When the cwd is a git
   repo the diff SHALL render from `gitDiff` (real or synthetic-for-untracked). When it is
   not a git repo, or `gitDiff` is absent, the panel SHALL render a diff derived from the
   session change payload (Write `content` / Edit `oldText`/`newText`) and SHALL NOT blank.

3. **First-class file preview in the split diff tab.** The split `DiffViewer` tab SHALL
   expose file preview as a first-class control (not buried behind the diff-only toolbar),
   letting the user view the whole current file with syntax highlighting alongside the diff.

## Impact

- Affected specs: `change-summary-table`, `session-diff-extraction`, `file-diff-view`
- Affected code: `packages/client/src/lib/lineDelta.ts`,
  `packages/client/src/components/ChatView.tsx` (openDiffFile),
  `packages/client/src/components/SplitWorkspaceContext.tsx` (openDiffTab),
  `packages/client/src/components/editor-pane/DiffViewer.tsx`,
  `packages/client/src/components/DiffPanel.tsx`,
  `packages/server/src/session-diff.ts` (contract clarification only; behavior already
  normalizes server-side)
- No protocol/wire change; `data.files` keys are unchanged (already relative).

## Discipline Skills

- `systematic-debugging` — the fix follows a diagnosed root cause (path-format mismatch);
  reproduce with an absolute-path Write before touching code.
- `doubt-driven-review` — path normalization is a cross-boundary (client/server) agreement;
  verify the abs↔rel rule against the server's `normalizePath` before it stands.
