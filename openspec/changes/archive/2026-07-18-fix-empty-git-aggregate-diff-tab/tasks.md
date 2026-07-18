## 1. Reproduce + guard (TDD, red first)

- [x] 1.1 Add a Path B payload test in `packages/client/src/components/__tests__/` that renders `DiffPanel` for a file with a non-empty `file.gitDiff`, no selected change (`changeIndex: null`), and asserts the `hunks` array handed to `<DiffView>`'s `data` prop retains the `diff --git`/`+++` header. Capture the prop via the existing `@git-diff-view/react` mock. Confirm it FAILS against current `extractHunks`-stripped output.
- [x] 1.2 Add an integration assertion using the REAL `@git-diff-view/core`: build the Path B `data` payload and assert the resulting `DiffFile` yields `unifiedLineLength > 0` (guards the exact empty-diff regression the mocked tests miss). Confirm it FAILS today for bare-hunk input.
- [x] 1.3 Add a Path C test: `DiffPanel` with `file.changes = [edit, tool]` (tool last), no `gitDiff`, `changeIndex: null` → asserts the edit's diff renders (not the "No diff data available" note). Confirm it FAILS today (last change is `type:"tool"` → null).

## 2. Fix Path B — header-preserving hunks

- [x] 2.1 In `packages/client/src/components/DiffPanel.tsx`, change the git-aggregate branch to pass `hunks: [file.gitDiff]` (whole header-bearing diff) instead of `hunks: extractHunks(file.gitDiff)`. Keep the `<DiffView data={...}>` component and the empty `oldFile`/`newFile` `content` unchanged. Keep the `hunks.length > 0` guard by checking `extractHunks(file.gitDiff).length > 0` (still the right "has parseable hunks" gate) while passing the whole diff as the payload.
- [x] 2.2 Verify `extractHunks` remains imported/used only by `buildPreviewLines` (Preview mode) and is otherwise unchanged.

## 3. Fix Path C — prefer a renderable change

- [x] 3.1 In `DiffPanel.tsx`, replace the Path C `file.changes[file.changes.length - 1]` read with a newest→oldest scan that picks the first change for which `buildChangeDiffTexts(file.path, mergeFull(change))` is non-null; fall through to `null` (→ existing note) only when none qualifies.
- [x] 3.2 Ensure the lazy full-payload upgrade (`activeChange`/`fullPayload`) still keys off the correct change (the one actually rendered) so truncated edits still upgrade.

## 4. Verify green + no regressions

- [x] 4.1 `npm test 2>&1 | tee /tmp/pi-test.log` — all three new tests pass; grep for `FAIL`. Existing `DiffPanelTheme`/`DiffPanelPreview`/`RichDiff` tests still pass.
- [x] 4.2 `review-code` pass on the `DiffPanel.tsx` diff before commit; keep the change surgical (payload + selection only).

## 5. Docs / tree

- [x] 5.1 Update `packages/client/src/components/DiffPanel.tsx.AGENTS.md`: record the header-preserving git-aggregate `hunks` payload and the Path C renderable-change fallback (caveman style, add `See change: fix-empty-git-aggregate-diff-tab`).

## 6. Manual QA (verify later)

- [x] 6.1 In a worktree with a git-tracked, edited file, open a `diff:` tab from the ChatView change-list → Diff view shows the change (non-empty); File toggle still shows current content. (Reproduces the original report.)
- [x] 6.2 Open a `diff:` tab for a non-git file created by a bash command → Diff view shows the write/edit diff, not the empty note.
