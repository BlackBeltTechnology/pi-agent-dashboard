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

## 4. First-class file preview in split (Decision 3)
- [x] 4.1 Surface the `Diff / File` preview as a persistent labeled control in the split
      `DiffViewer` header (default Diff), reusing `/api/session-file` + `SyntaxHighlighter`.
      → verify: clicking Preview shows the whole file; Diff returns to the diff.

## 5. Regression + docs
- [x] 5.1 `npm test` green (client + server). → verify: tee to /tmp, grep FAIL.
- [x] 5.2 Update `docs/architecture.md` "Session File Diff View" note re client/server path
      agreement (delegate to a subagent, caveman style). → verify: kb_search finds it.

## 6. Sibling `openInSplit` sinks + duplicate-tab (design addendum)
- [ ] 6.1 Move normalization into the two shared sinks `openDiffTab`/`openInSplit`
      (`SplitWorkspaceContext.tsx`) via `toSessionRel(cwd, p)`, **mirroring the server guard**
      (`session-routes.ts:103` / `path-containment.ts:47`): `isAbsolute(p) &&
      !relative(cwd,p).startsWith("..") && !isAbsolute(relative(cwd,p)) ? relative(cwd,p) : p`.
      → verify: unit test — in-cwd abs → relative-posix; abs-outside-cwd, cross-drive
      (`path.win32`), already-relative → unchanged. (input: cwd + candidate paths · trigger:
      call `toSessionRel` · observable: in-cwd→relative, out-of-cwd/cross-drive→identity)
      (see `packages/client/src/components/__tests__/SplitWorkspaceContext.test.tsx`)
      (test-plan #A1)
- [ ] 6.2 Assert the sink normalization yields a canonical relative tab identity: `openInSplit`
      /`openDiffTab` with an abs-under-cwd path store the relative key (no `cwd//abs`
      double-root; watch set carries relative). → verify: L1 context test. (input:
      SplitWorkspace with cwd · trigger: openInSplit/openDiffTab(abs-under-cwd) · observable:
      stored `openFiles[].path` = rel / `diff:<rel>`)
      (see `packages/client/src/components/__tests__/SplitWorkspaceContext.test.tsx`)
      (test-plan #A2)
- [ ] 6.3 Reducer duplicate-tab collapse: same file arriving as `diff:/abs` then `diff:<rel>`
      (both `diff:<rel>` post-normalization) yields ONE `openFiles` entry. → verify: L1
      reducer test. (input: openFile diff:/abs then diff:rel for one file · trigger: `openFile`
      reducer · observable: `openFiles.length === 1`)
      (see `packages/client/src/lib/__tests__/editor-pane-state.test.ts`) (test-plan #A3)
- [ ] 6.4 E2E regression — content-view row vs Changes rail resolve to ONE tab. → verify:
      docker-harness spec. (input: session with changes, desktop; click content-view summary
      row for X then rail row for X · trigger: UI · observable: exactly one editor tab for X)
      (see `tests/e2e/change-summary-table.spec.ts` + `tests/e2e/editor-pane.spec.ts`)
      (test-plan #A4)
- [ ] 6.5 E2E — editor deep-link `?file=<abs-under-cwd>` opens a canonical relative file tab
      that renders (no error, no duplicate). → verify: docker-harness spec. (input: navigate
      `/session/:id/editor?file=<abs>` · trigger: `SplitRouteSync`→`openInSplit` · observable:
      file tab opens with relative identity, content renders)
      (see `tests/e2e/editor-pane.spec.ts`) (test-plan #A5)

## Tests / Validate
- [x] T.1 Absolute-path Write session → summary row opens a rendered additive diff (not blank).
- [x] T.2 Non-git cwd session → diff renders from session payload.
- [x] T.3 Split diff tab → Preview shows full file, toggles back to Diff.
