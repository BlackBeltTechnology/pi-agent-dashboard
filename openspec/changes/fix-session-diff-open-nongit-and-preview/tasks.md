# Tasks — fix-session-diff-open-nongit-and-preview

## 1. Reproduce (systematic-debugging)
- [x] 1.1 Add a failing test: a session whose Write records an **absolute** path under cwd →
      `ChangeSummaryBlock` row path + the value passed to `openDiffTab` resolve to the
      relative key present in `data.files`. → verify: test red before fix.

## 2. Path normalization (Decision 1)
- [x] 2.1 Add shared `normalizeUnderCwd(rawPath, cwd)` helper (absolute && under cwd →
      relative-posix; else unchanged) mirroring `session-diff.ts::normalizePath`. →
      verify: unit tests for abs-under-cwd, abs-outside-cwd, already-relative, Windows sep.
- [x] 2.2 Normalize in `ChatView.openDiffFile` using `splitWs.cwd` before `openDiffTab`;
      normalize the row display path too so display and lookup can't diverge. → verify:
      2.1 test green.
- [x] 2.3 Defensive fallback in `DiffViewer`: on exact-match miss, retry with the
      cwd-normalized path. → verify: unit test with an absolute `diff:` path resolves.

## 3. git ⇒ gitDiff, else session diff (Decision 2)
- [x] 3.1 State the precedence in `DiffPanel` (selected change → gitDiff → session-derived);
      guarantee the non-git / no-gitDiff branch renders the file's own change payload. →
      verify: test that a non-git session file renders an all-additions diff, not blank.
      (Already implemented in DiffPanel: change → gitDiff → lastChange session payload.)

## 4. First-class file preview in split (Decision 3)
- [x] 4.1 Surface the `Diff / File` preview as a persistent labeled control in the split
      `DiffViewer` header (default Diff), reusing `/api/session-file` + `SyntaxHighlighter`.
      → verify: clicking Preview shows the whole file; Diff returns to the diff.
      (Existing DiffPanel control verified live: full file loads, Diff restores diff.)

## 5. Regression + docs
- [x] 5.1 Targeted client tests green (`session-rel-path`, `DiffViewer`, `lineDelta`).
- [ ] 5.2 Update `docs/architecture.md` "Session File Diff View" note re client/server path
      agreement (delegate to a subagent, caveman style). → verify: kb_search finds it.

## Tests / Validate
- [x] T.1 Absolute-path Write session → summary row opens a rendered additive diff (not blank).
- [x] T.2 Non-git cwd session → diff renders from session payload (DiffPanel Path A).
- [x] T.3 Split diff tab → Preview shows full file, toggles back to Diff.
