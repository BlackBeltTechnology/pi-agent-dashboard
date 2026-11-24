## 1. Server — raw route download mode

- [x] 1.1 Extract pure helper `contentDispositionAttachment(name)` (ASCII fallback replacing non-printable-ASCII, `"` and `\` with `_`; RFC 5987 `filename*`) per design D2, and move the EML-attachment site (`packages/server/src/routes/file-routes.ts:1996-2005`) onto it
- [x] 1.2 Extend the `/api/file/raw` querystring type with optional `download`; when `download === "1"` set the attachment disposition from the resolved path's basename, else keep `inline`; leave admission, containment, CSP/nosniff, cache and Range untouched (design D1)

## 2. Client — shared download helper

- [x] 2.1 Add `downloadUrl(target)` to `packages/client/src/components/preview/raw-url.ts`
- [x] 2.2 Add a download helper module next to `raw-url.ts` exporting `startDownload(target, { outsideCwd })`: link path when `getApiBase() === ""` and inside cwd; otherwise fetch through the global wrapper → Blob → save as basename → revoke object URL; error toast on non-OK / network error (design D3)

## 3. Client — document bar Download

- [x] 3.1 Add optional `hint` prop to `MenuItem` (muted second line) and optional `returnFocusTo` to `MenuPopover` (default `anchorEl`) in `packages/client/src/components/editor-pane/MenuPopover.tsx`
- [x] 3.2 Extract the inline dirty predicate in `EditorPane.tsx:579-588` into `isTabDirty(tab)`, reuse it for `unsavedPaths`, and pass `dirty` to `DocumentBar`
- [x] 3.3 Add the `doc-download` item to `MoreMenu` for file tabs, using the viewer's target and `outsideCwd`; show the "Unsaved changes not included" hint when `dirty` (design D4)

## 4. Client — file-tree row actions menu

- [x] 4.1 Replace `RowCopyAffordance` with `RowActionsMenu` built on `MenuPopover` in `EditorFileTree.tsx`: absolute-path header, glyph `mdiDotsHorizontal` + "Row actions" + `aria-haspopup`/`aria-expanded`, `[@media(hover:none)]:opacity-100`, rail-scroll dismissal kept (design D5)
- [x] 4.2 Add `isDir` prop; file rows append `tree-row-download` calling `startDownload` and closing immediately; directory rows keep copy actions only
- [x] 4.3 Wire row `onContextMenu` (preventDefault + open anchored to glyph) and `ContextMenu` / Shift+F10 on the row button, for file and directory rows; opening never opens the file or toggles the directory
- [x] 4.4 Update existing `EditorFileTree` copy-path tests for the renamed glyph label and `MenuPopover` structure

## 5. i18n + docs

- [x] 5.1 Add `editor.rowActions`, `editor.downloadUnsavedHint` and `editor.downloadFailed` to every locale table (reuse `common.download`)
- [x] 5.2 Update the `EditorFileTree.tsx`, `DocumentBar.tsx` and `MenuPopover.tsx` rows in `packages/client/src/components/editor-pane/AGENTS.md`, the `raw-url.ts` / new helper rows in `packages/client/src/components/preview/AGENTS.md`, and the `file-routes.ts` AGENTS row for `download=1` and the shared header helper

## 6. Tests — server (L1, vitest)

- [x] 6.1 Unit-test `contentDispositionAttachment` plain name (see sibling pure tests in `packages/server/src/__tests__/`): input `summary.md` · helper call · returns `attachment; filename="summary.md"; filename*=UTF-8''summary.md` (test-plan #E1)
- [x] 6.2 Unit-test non-ASCII name (same file as 6.1): input `jelentés é.pdf` · helper call · `filename="jelent_s _.pdf"` and `filename*=UTF-8''jelent%C3%A9s%20%C3%A9.pdf` (test-plan #E2)
- [x] 6.3 Unit-test header injection (same file as 6.1): input `a"b\r\nX-Evil: 1.txt` · helper call · no CR/LF anywhere and no `"` inside the `filename="…"` value; `filename*` percent-encodes them (test-plan #E3)
- [x] 6.4 Unit-test attr-char boundary (same file as 6.1): input `a\b'(x)*!~.txt` · helper call · `\`→`_` in ASCII part; `filename*` has `%27%28%29%2A` and literal `!~` (test-plan #E4)
- [x] 6.5 Route test download mode, see `packages/server/src/__tests__/file-artifact-serving.test.ts` for raw-route inject glue: `notes/summary.md` in admitted cwd · `GET /api/file/raw?…&download=1` · 200, body = file bytes, disposition = E1 value (test-plan #E5)
- [x] 6.6 Route test `download` decision table (exemplar `file-artifact-serving.test.ts`): same file · `download` absent / `0` / `true` / `1` · only `1` yields attachment, others `inline` (test-plan #E6)
- [x] 6.7 Route test sandbox kept (exemplar `packages/server/src/__tests__/csp.test.ts`): `page.svg` · `GET …&download=1` · `content-security-policy` = `RAW_SANDBOX_CSP`, `nosniff`, attachment disposition (test-plan #E7)
- [x] 6.8 Route test Range kept (exemplar `file-artifact-serving.test.ts`): 4096-byte file · `download=1` + `Range: bytes=1024-2047` · 206, `content-range: bytes 1024-2047/4096`, attachment (test-plan #E8)
- [x] 6.9 Route test admission unchanged (exemplar `packages/server/src/__tests__/file-cwd-admission-routes.test.ts`): `cwd=/unknown` and traversal path · each with `download=1` · 403 `cwd_unknown` / 403 `path outside working directory`, identical to no-`download` bodies (test-plan #E9)
- [x] 6.10 Route test EML on shared helper (exemplar `packages/server/src/__tests__/containment-swap-sites.test.ts` EML glue): attachment filename `a\b.txt` · `GET /api/file/eml-attachment?…&index=0` · disposition `attachment; filename="a_b.txt"; filename*=UTF-8''a%5Cb.txt` (test-plan #E10)
- [x] 6.11 Route test missing file (exemplar `file-artifact-serving.test.ts`): nonexistent `path` · `GET …&download=1` · 404 and no attachment disposition on the error response (test-plan #X3)

## 7. Tests — client helper (L1, vitest)

- [x] 7.1 Test `startDownload` delivery decision table, see `packages/client/src/components/preview/__tests__/is-external-href.test.ts` for pure-module glue: `getApiBase()` ∈ {`""`, cross-origin} × `outsideCwd` ∈ {false,true} · `startDownload` · only (`""`, false) clicks an `<a download>` with `href = downloadUrl(target)` and no fetch; other three call `fetch(downloadUrl(target))` (test-plan #E11)
- [x] 7.2 Test Blob success (same file as 7.1): cross-origin base, fetch 200 body `hello` · `startDownload({cwd:"/Users/u/proj", path:"notes/summary.md"})` · `createObjectURL` once, anchor `download="summary.md"`, `revokeObjectURL` with same URL (test-plan #E12)
- [x] 7.3 Test `downloadUrl` encoding (same file as 7.1): `{cwd:"/Users/u/proj", path:"notes/summary.md"}`, base `""` · `downloadUrl` · `/api/file/raw?cwd=%2FUsers%2Fu%2Fproj&path=notes%2Fsummary.md&download=1` (test-plan #E13)
- [x] 7.4 Test HTTP failure (same file as 7.1): fetch `{ok:false,status:404}` then 403 · Blob path · error toast with `editor.downloadFailed` text, no `createObjectURL`, no anchor click (test-plan #X1)
- [x] 7.5 Test network failure (same file as 7.1): fetch rejects `TypeError("Failed to fetch")` · Blob path · error toast, no save, no unhandled rejection (test-plan #X2)

## 8. Tests — document bar (L1, vitest + RTL)

- [x] 8.1 More-menu Download, see `packages/client/src/components/editor-pane/__tests__/EditorPane.chrome.test.tsx` + `chrome-harness.tsx`: active tab `notes/summary.md` · open `doc-more-menu`, click `doc-download` · `startDownload` called with `{cwd, path:"notes/summary.md"}`, `outsideCwd:false`; panel removed (test-plan #F1)
- [x] 8.2 Dirty hint decision table (exemplar `EditorPane.chrome.test.tsx`): clean / built-in dirty / handler dirty tab · open More menu · clean → no hint; dirty → `doc-download` enabled with "Unsaved changes not included" (test-plan #F2)
- [x] 8.3 Outside-cwd tab (exemplar `EditorPane.chrome.test.tsx`): `outsideCwd` tab · click `doc-download` · `startDownload` called with `outsideCwd:true` (test-plan #F3)
- [x] 8.4 Non-file tabs (exemplar `EditorPane.chrome.test.tsx`): URL tab, terminal tab · render document bar · no `doc-download` in DOM (test-plan #F4)

## 9. Tests — file-tree row actions menu (L1, vitest + RTL)

- [x] 9.1 Menu contents, see `packages/client/src/components/editor-pane/__tests__/EditorFileTree.test.tsx`: file row `src/foo.ts`, dir row `.git` · activate glyph · file: Copy full/relative/name then `tree-row-download`; dir: three copy items, no `tree-row-download` (test-plan #F5)
- [x] 9.2 Right-click (exemplar `EditorFileTree.test.tsx`): file row `src/foo.ts`, dir row `src` · `fireEvent.contextMenu(row)` · `defaultPrevented` true, menu open, `onOpenFile` / `onToggleRoot` not called (test-plan #F6)
- [x] 9.3 Keyboard open (exemplar `EditorFileTree.test.tsx`): focused row button `src/foo.ts` · Shift+F10, ↓, Enter (and `ContextMenu` key) · focus starts on Copy full path; clipboard gets `src/foo.ts` (test-plan #F7)
- [x] 9.4 Escape focus return (exemplar `EditorFileTree.test.tsx`): opened via glyph / via Shift+F10 · Escape · focus returns to glyph / row button respectively (test-plan #F8)
- [x] 9.5 Tree Download (exemplar `EditorFileTree.test.tsx`): file row `docs/report.pdf`, cwd `/Users/u/proj` · click `tree-row-download` · `startDownload` called with `{cwd:"/Users/u/proj", path:"docs/report.pdf"}`, menu closed, `onOpenFile` not called (test-plan #F9)
- [x] 9.6 Glyph a11y + touch class (exemplar `EditorFileTree.test.tsx`): any row · render and open · `aria-label="Row actions"`, `aria-haspopup="menu"`, `aria-expanded` false→true, class contains `[@media(hover:none)]:opacity-100` (test-plan #F10)
- [x] 9.7 Dismissal (exemplar `EditorFileTree.test.tsx`): open row menu · outside click / rail scroll / Escape · menu closes, no clipboard write, no `startDownload` (test-plan #F11)

## 10. Tests — end-to-end (L3, Playwright)

- [x] 10.1 Viewer download e2e, see `tests/e2e/editor-pane-chrome.spec.ts` for harness glue: harness file `notes/summary.md` with known content · open it, More → Download, `page.waitForEvent('download')` · `suggestedFilename() === "summary.md"` and saved bytes equal the content (test-plan #F12)
- [x] 10.2 Tree right-click download e2e (exemplar `tests/e2e/editor-pane-chrome.spec.ts`): same file in rail · right-click row → Download · download event `suggestedFilename() === "summary.md"`; open tabs unchanged (test-plan #F13)

## 11. Manual verification

- [x] 11.1 Touch devices: on iOS Safari / Android Chrome the glyph is visible, tap opens the menu, Download lands in device downloads (test-plan: manual-only, #F14)
- [x] 11.2 Electron: Download from local main window and a remote server window shows a native save dialog and saves correct bytes (test-plan: manual-only, #F15)
- [x] 11.3 Hint presentation in dark + light theme reads as secondary text (test-plan: manual-only, #F16)
