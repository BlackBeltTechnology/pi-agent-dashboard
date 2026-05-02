## 1. Extract `<RichDiff>` shared component

- [x] 1.1 Create `packages/client/src/components/RichDiff.tsx` with prop contract `{ oldText: string; newText: string; filePath: string; mode?: "unified" | "split"; maxHeight?: string }`. Default `mode` to `"unified"`.
- [x] 1.2 Move `EXT_LANG_MAP` (the `.ts → "typescript"`-style map currently inlined in `DiffPanel.tsx`) into `RichDiff.tsx`. Leave `EXT_PRISM_MAP` in `DiffPanel.tsx` (it serves the non-diff syntax-highlighter path).
- [x] 1.3 Inside `<RichDiff>`: derive language from `filePath` via `EXT_LANG_MAP` with a plaintext fallback for unknown extensions (must not throw); call `generateDiffFile(filePath, oldText, filePath, newText, lang, lang)`; call `.init()`, `.buildSplitDiffLines()`, `.buildUnifiedDiffLines()`; render `<DiffView>` from `@git-diff-view/react`. The component MUST set the following `<DiffView>` props internally so callers do not pass them:
  - `diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}`
  - `diffViewTheme={resolved}` where `resolved` comes from `useThemeContext()` (`"light" | "dark"`) — NOT the hardcoded `"dark"` value DiffPanel currently uses; this gives chat diffs proper light/dark mode.
  - `diffViewHighlight`
  - `diffViewWrap`
  - `registerHighlighter={highlighter}` (from `@git-diff-view/lowlight`)
- [x] 1.4 Wrap output in a container that applies `style={{ maxHeight }}` and `overflow-auto` only when `maxHeight` is provided; when omitted, height is parent-driven (DiffPanel's existing layout).
- [x] 1.5 Ensure `<RichDiff>` does NOT render any toolbar, mode toggle, file-metadata header, or expand controls — pure rendering primitive only.
- [x] 1.6 Verify `import "@git-diff-view/react/styles/diff-view.css"` is reachable from the new component path (the import is currently in `DiffPanel.tsx`; either keep it there or move to `RichDiff.tsx` so chat call sites also load it).

## 2. Tests for `<RichDiff>`

- [x] 2.1 Add `packages/client/src/components/__tests__/RichDiff.test.tsx`. Use the project's existing testing-library setup.
- [x] 2.2 Test: renders unified mode by default (no `mode` prop).
- [x] 2.3 Test: renders split mode when `mode="split"`.
- [x] 2.4 Test: applies `maxHeight` style and overflow-auto when prop provided; omits it when not.
- [x] 2.5 Test: resolves `filePath="foo.ts"` to TypeScript language at the `generateDiffFile` boundary (mock or spy `generateDiffFile`).
- [x] 2.6 Test: unknown extension (e.g. `.xyz`) falls back to plaintext without throwing.
- [x] 2.7 Test: identical input renders the same DOM (snapshot or structural assertion) — guards against accidental tokenizer drift.

## 3. Refactor `DiffPanel` to consume `<RichDiff>` (Path A only)

`DiffPanel` renders `<DiffView>` with two distinct input shapes: **Path A** uses the `diffFile` prop built via `generateDiffFile` (Edit / Write / lastChange branches inside `buildChangeDiffFile`); **Path B** uses the raw `data` prop with `{ oldFile, newFile, hunks }` (the git aggregate diff branch when `file.gitDiff` is set). This change extracts ONLY Path A into `<RichDiff>`. Path B keeps its inline `<DiffView>` inside `DiffPanel` because `<RichDiff>`'s API is deliberately narrow `(oldText, newText, filePath)` — see design D1.

- [x] 3.1 In `packages/client/src/components/DiffPanel.tsx`, replace the Path A `<DiffView>` invocation (the one fed by `diffData.diffFile`) with `<RichDiff oldText={...} newText={...} filePath={file.path} mode={diffMode === DiffModeEnum.Split ? "split" : "unified"} />`. Source `oldText` / `newText` from the existing `buildChangeDiffFile` logic — refactor `buildChangeDiffFile` to return `{ oldText, newText }` instead of a `DiffFile`, since `<RichDiff>` now owns `generateDiffFile`/`.init()`/`.buildSplitDiffLines()`/`.buildUnifiedDiffLines()`.
- [x] 3.2 LEAVE the Path B `<DiffView>` invocation (the one fed by `diffData.data` with raw hunks) inline in `DiffPanel.tsx`. Do not attempt to route it through `<RichDiff>`.
- [x] 3.3 Do NOT pass `maxHeight` from `DiffPanel` — it lives in the content area and uses parent flex sizing (per design D4).
- [x] 3.4 Verify `DiffPanel`'s split↔unified toggle, file-metadata header, view-mode toggle (diff/file), and Edit-vs-Write-vs-aggregate dispatch logic remain in `DiffPanel.tsx` and are unchanged in behavior.
- [x] 3.5 Remove `EXT_LANG_MAP` and `getLang` from `DiffPanel.tsx` for the Path A branch (now lives in `RichDiff.tsx`). Path B's git-aggregate-diff branch still needs `getLang` for its inline `oldFile.fileLang` / `newFile.fileLang` — either keep `getLang` + `EXT_LANG_MAP` in `DiffPanel.tsx` for Path B's sole use, or export a `getLang(filePath)` helper from `RichDiff.tsx` and import it in `DiffPanel.tsx`. Pick the latter to avoid the lang map living in two places.
- [x] 3.6 Keep `EXT_PRISM_MAP` and `getPrismLang` in `DiffPanel.tsx` (consumed by the `viewMode === "file"` branch which uses `react-syntax-highlighter`, NOT `<RichDiff>`).
- [x] 3.7 Manual smoke test: open `FileDiffView` from a session header → confirm visual parity with pre-change behavior, including split↔unified toggle, view-mode toggle (diff/file), Edit vs Write vs aggregate change rendering, and theme switching.

## 4. Switch `EditToolRenderer` to viewport-class branch

- [x] 4.1 In `packages/client/src/components/tool-renderers/EditToolRenderer.tsx`, import `useMobile` from `../../hooks/useMobile.js` and `RichDiff` from `../RichDiff.js`.
- [x] 4.2 Inside the `EditToolRenderer` function, call `const isMobile = useMobile()`.
- [x] 4.3 Update `renderDiffs()`: in both the `oldText`/`newText` branch and the `edits[]` branch, render `<RichDiff oldText={...} newText={...} filePath={filePath ?? "file"} maxHeight="20rem" />` when `!isMobile`, else render the existing local `DiffView` component. Do NOT pass a `mode` prop — defaults to unified per spec.
- [x] 4.4 Keep the existing local `DiffView` component declaration in `EditToolRenderer.tsx` — it remains the mobile fallback. Do not delete it.
- [x] 4.5 Keep the empty-data → raw-JSON fallback unchanged (viewport-independent per spec).
- [x] 4.6 Keep the existing `OpenFileButton`, file-path header, and result-text rendering unchanged.

## 5. Tests for `EditToolRenderer` viewport branch

- [x] 5.1 Add or extend `packages/client/src/components/tool-renderers/__tests__/EditToolRenderer.test.tsx`. Mock `useMobile` to control viewport class.
- [x] 5.2 Test: with `useMobile() === false` and `oldText`/`newText` args → `<RichDiff>` is rendered, homegrown `DiffView` is NOT.
- [x] 5.3 Test: with `useMobile() === true` and `oldText`/`newText` args → homegrown `DiffView` is rendered, `<RichDiff>` is NOT.
- [x] 5.4 Test: with `useMobile() === false` and `edits[]` of length 3 → exactly 3 `<RichDiff>` instances rendered, separated by border classes.
- [x] 5.5 Test: with `useMobile() === true` and `edits[]` of length 3 → exactly 3 homegrown `DiffView` instances rendered, separated by border classes.
- [x] 5.6 Test: with neither `oldText`/`newText` nor `edits[]` → raw JSON `<pre>` is rendered regardless of viewport class.

## 6. Lazy-mount regression coverage

- [x] 6.1 Add a test in `packages/client/src/components/__tests__/ToolCallStep.test.tsx` (or extend existing) that asserts: when an Edit `ToolCallStep` renders in its default collapsed state on desktop, no `<RichDiff>` is in the DOM (query by a stable test id or component role).
- [x] 6.2 Add the complementary test: clicking the chevron expands the card and `<RichDiff>` appears in the DOM.
- [x] 6.3 If a stable test id does not exist on `<RichDiff>`, add `data-testid="rich-diff"` on its outermost element to make the assertion robust.

## 7. Validation and cleanup

- [x] 7.1 Run `npm test 2>&1 | tee /tmp/pi-test.log` and grep for failures (`grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log`). Fix any regressions in tool-renderer / diff-panel / file-diff-view tests.
- [x] 7.2 Run `npm run build` and confirm it succeeds — checks that the new component path is correctly imported and bundled.
- [x] 7.3 Manual desktop smoke: trigger an Edit tool call → expand the card → confirm rich syntax-highlighted diff appears with capped height + internal scroll.
- [x] 7.4 Manual mobile smoke (resize window below 768px or use device mode): trigger an Edit tool call → expand → confirm the existing homegrown line-colored diff still renders.
- [x] 7.5 Manual `FileDiffView` smoke: open a session with file changes → click "View changes" in the session header → confirm split/unified toggle still works and the diff still renders identically to before.

## 8. Documentation

- [x] 8.1 Update `AGENTS.md` "Key Files" table: add a row for `packages/client/src/components/RichDiff.tsx` describing it as the shared rich-diff primitive consumed by `EditToolRenderer` (desktop) and `DiffPanel`. Cross-reference change `rich-diff-in-chat`.
- [x] 8.2 Update the existing `EditToolRenderer.tsx` row in `AGENTS.md` to note the desktop-vs-mobile branch on `useMobile()`.
- [x] 8.3 Update the existing `DiffPanel.tsx` row in `AGENTS.md` to note that single-file rendering is delegated to `<RichDiff>`.
- [x] 8.4 If `docs/architecture.md` describes the chat tool-rendering pipeline, add a short note about the desktop/mobile diff branch and the lazy-mount inheritance from `ToolCallStep`.
