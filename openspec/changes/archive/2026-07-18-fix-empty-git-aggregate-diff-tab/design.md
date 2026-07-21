## Context

`DiffPanel` has three diff-derivation paths (in precedence order) for `viewMode === "diff"`:

- **Path A** — a specific change is selected (`selection.changeIndex !== null`) → build `oldText`/`newText` via `buildChangeDiffTexts` → render `<RichDiff>`.
- **Path B** — else `file.gitDiff` present → render `<DiffView data={{ oldFile, newFile, hunks }}/>` (raw `@git-diff-view` git-aggregate mode).
- **Path C** — else → derive from the file's last change via `buildChangeDiffTexts` → `<RichDiff>`.

The `diff:` tab (`DiffViewer`) always passes `changeIndex: null`, so it can only ever take Path B or Path C — never Path A. Path A is exercised only by the inline chat change-cards (which select a change), which is why those render while the tab does not.

## Decision D1 — Preserve the diff header in Path B's `hunks`

`@git-diff-view/core` builds a `DiffFile` as `new DiffFile(oldName, oldContent, newName, newContent, hunks, oldLang, newLang)`. When `oldContent`/`newContent` are empty (Path B passes `content: ""`), the ONLY source of truth is `hunks`, and the parser materializes lines **only when each hunk string carries the unified-diff file header** (`diff --git`/`---`/`+++`). `extractHunks` deletes exactly those header lines.

`file.gitDiff` from the server (`git diff HEAD -- <path>`) is already a complete unified diff **with** that header. Passing it as a single array element — `hunks: [file.gitDiff]` — is the minimal correct fix: the header is preserved and multi-hunk diffs parse correctly (verified: a 2-hunk diff renders 7 unified / 6 split lines).

**Rejected alternative — reconstruct `oldText`/`newText` and route through `<RichDiff>`:** the `tool-renderers` spec deliberately keeps the git-aggregate path on the raw `data` prop ("`<RichDiff>`'s API is narrowly scoped to `(oldText, newText, filePath)` and does not accept the raw hunks shape"). Full file texts are not available in the aggregate path (only hunk regions are), so reconstruction would be lossy. Keep `<DiffView>`; fix the payload.

**Rejected alternative — bump `@git-diff-view`:** the behavior is by-design (needs content or a header-bearing diff); an upgrade is unnecessary risk and out of scope.

## Decision D2 — Path C prefers a change with renderable texts

`buildChangeDiffTexts` returns `null` for `type:"tool"` (detected-on-disk-only) events. Path C currently reads only `file.changes[file.changes.length - 1]`; if that last event is a `type:"tool"` event (common for bash-artifact / git-status detection), the panel is empty even when an earlier `edit`/`write` event on the same file exists.

Path C SHALL scan `file.changes` from newest to oldest and use the first change for which `buildChangeDiffTexts` returns non-null; only when none exists does it fall through to the existing "No diff data available" note. This is a targeted selection change — no new rendering surface.

## Verification

- Unit: assert Path B's constructed `data.hunks` contains the `diff --git`/`+++` header (payload-shape test, mock-free on the pure builder).
- Integration (real `@git-diff-view`): a git-aggregate `file.gitDiff` renders ≥ 1 diff line (non-empty), guarding the exact regression.
- Unit: Path C with `changes: [edit, tool]` (tool last) renders the edit's diff, not the empty note.
- Manual: open a `diff:` tab for a git-tracked, edited file in a worktree — the Diff view shows the change; the File toggle still works.
